/**
 * Vercel Cron: Sends heart rate and wellness updates to Kick chat when enabled.
 * Silently pushes stream title updates when location changes and autoUpdateLocation is on.
 * Runs every 1 minute.
 *
 * Location: Stream title updated silently (no chat announcement) when autoUpdateLocation is on.
 * Heart rate: high/very-high warning on threshold crossing. No spam until HR drops below, then exceeds again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { getPersistentLocation, getLocationData } from '@/utils/location-cache';
import type { LocationDisplayMode } from '@/types/settings';
import { isStreamLive, getStreamStartedAt, onStreamStarted, healStreamStateFromKickAPI } from '@/utils/stats-storage';
import { getStreamTitleLocationPart, buildStreamTitle } from '@/utils/stream-title-utils';
import { getStreamGoals } from '@/utils/stream-goals-storage';

import { KICK_API_BASE, KICK_STREAM_TITLE_SETTINGS_KEY, getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { pollStreamElementsTips } from '@/lib/streamelements-client';
import { TRIVIA_STATE_KEY, type TriviaState } from '@/types/trivia';
import { setTriviaState } from '@/lib/trivia-store';
import { maybeBroadcastWeather, maybeBroadcastWellness, maybeBroadcastStats } from '@/lib/chat-broadcast-service';
const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';
const KICK_BROADCAST_LAST_LOCATION_MSG_KEY = 'kick_chat_broadcast_last_location_msg';
const OVERLAY_SETTINGS_KEY = 'overlay_settings';

// Milestones for 48h+ streams — steps/distance can exceed limits (logic in wellness-milestone-chat)

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const diagnostic = url.searchParams.get('diagnostic') === '1';

  const runAt = new Date().toISOString();
  console.log('[Cron HR] CRON_START', JSON.stringify({ runAt }));
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'no_token', runAt }));
    return NextResponse.json(
      diagnostic ? { ok: true, sent: 0, debug: { reason: 'no_token', tokenPresent: false } } : { ok: true, sent: 0 }
    );
  }

  const [lastLocationMsg, overlaySettings, streamTitleSettings, kvIsLive] = await Promise.all([
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<{ locationDisplay?: string; customLocation?: string; streamerTimezone?: string; showSubGoal?: boolean; subGoalTarget?: number; showKicksGoal?: boolean; kicksGoalTarget?: number }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    isStreamLive(),
  ]);

  const now = Date.now();

  let sent = 0;
  const debug: Record<string, unknown> = diagnostic ? { tokenPresent: true } : {} as Record<string, unknown>;

  // Fetch current stream title AND live status from Kick API
  // API is the source of truth; KV may be stale if webhook missed a stream start/end event.
  let currentTitle = '';
  let apiIsLive: boolean | null = null;
  try {
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      const ch = (channelData.data ?? [])[0];
      currentTitle = (ch?.stream_title ?? '').trim();
      if (typeof ch?.is_live === 'boolean') apiIsLive = ch.is_live;
    }
  } catch { /* ignore */ }

  // Prefer API truth; fall back to KV if API didn't return is_live
  const isLive = apiIsLive !== null ? apiIsLive : kvIsLive;

  // Heal stale KV so isStreamLive() stays accurate for other consumers
  if (apiIsLive !== null && apiIsLive !== kvIsLive) {
    void healStreamStateFromKickAPI(apiIsLive);
  }

  // If API says we're live but stream_started_at was never set (e.g. webhook missed go-live),
  // set it now so HR/speed/altitude session stats have a session and can show data.
  if (isLive) {
    const startedAt = await getStreamStartedAt();
    if (startedAt == null) {
      await onStreamStarted();
      console.log('[Cron HR] HEAL_STREAM_SESSION', JSON.stringify({ reason: 'api_live_but_no_stream_started_at' }));
    }
  }

  if (diagnostic) debug.isLive = isLive;
  console.log('[Cron HR] LIVE_CHECK', JSON.stringify({ isLive, apiIsLive, kvIsLive, currentTitle: currentTitle.slice(0, 50) }));

  // ===== BROADCASTS (non-critical, can tolerate being skipped) =====

  // Pre-fetch fresh geocoded location data once for both stream title and weather sections.
  // When GPS has moved >300m since last geocode (cache was invalidated), this triggers fresh
  // geocoding via LocationIQ + RTIRL, keeping the stream title in sync with the overlay.
  let sharedLocationData: Awaited<ReturnType<typeof getLocationData>> = null;
  if (isLive) {
    try {
      sharedLocationData = await getLocationData(false);
    } catch { /* non-critical */ }
  }

  // Unified location: silently update stream title only — no chat announcements for auto-updates.
  // Update title whenever location/title changed (no interval gating) so title stays in sync with overlay.
  const autoUpdateLocation = streamTitleSettings?.autoUpdateLocation !== false;

  if (autoUpdateLocation && isLive) {
    // Use freshly geocoded location if available, fall back to persistent storage
    const freshLocationData = sharedLocationData?.location?.rawLocationData;
    const persistent = freshLocationData ? null : await getPersistentLocation();
    const locationForTitle = freshLocationData ?? persistent?.location;

    if (locationForTitle) {
      const includeLocationInTitle = streamTitleSettings?.includeLocationInTitle !== false;
      const displayMode = (overlaySettings?.locationDisplay as LocationDisplayMode) ?? 'city';
      const customLoc = (overlaySettings?.customLocation as string) ?? '';
      const formattedForTitle = getStreamTitleLocationPart(
        locationForTitle,
        displayMode,
        customLoc,
        includeLocationInTitle
      );

      const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
      let subInfoForTitle: { current: number; target: number } | undefined;
      let kicksInfoForTitle: { current: number; target: number } | undefined;
      if (overlaySettings?.showSubGoal || overlaySettings?.showKicksGoal) {
        const goals = await getStreamGoals();
        if (overlaySettings?.showSubGoal) {
          const subTarget = overlaySettings?.subGoalTarget ?? 5;
          subInfoForTitle = { current: goals.subs, target: subTarget };
        }
        if (overlaySettings?.showKicksGoal) {
          const kicksTarget = overlaySettings?.kicksGoalTarget ?? 5000;
          kicksInfoForTitle = { current: goals.kicks, target: kicksTarget };
        }
      }
      const newFullTitle = formattedForTitle ? buildStreamTitle(customTitle, formattedForTitle, subInfoForTitle, kicksInfoForTitle) : '';
      const titleChanged = formattedForTitle && newFullTitle !== currentTitle;
      // Dedup key tracks last location string to avoid redundant patches
      const locationChanged = formattedForTitle && formattedForTitle !== lastLocationMsg;

      if (titleChanged || locationChanged) {
        if (titleChanged && newFullTitle) {
          try {
            const patchRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ stream_title: newFullTitle }),
            });
            if (patchRes.ok) sent++;
          } catch {
            // ignore
          }
        }
        await kv.set(KICK_BROADCAST_LAST_LOCATION_KEY, now);
        await kv.set(KICK_BROADCAST_LAST_LOCATION_MSG_KEY, formattedForTitle ?? '');
      }
    }
  }

  // HR/speed/altitude broadcasts (shared with stats ingestion for immediate sends)
  sent += await maybeBroadcastStats({}, 'cron');

  // Weather broadcast: notable condition changes only (rain, snow, storm, fog, high UV, poor AQI). Not when clearing.
  sent += await maybeBroadcastWeather();

  // Wellness milestones: steps, distance (shared with import route for immediate send)
  const wellnessSent = await maybeBroadcastWellness();
  if (wellnessSent > 0) {
    sent += wellnessSent;
    console.log('[Cron HR] WELLNESS_MILESTONES', JSON.stringify({ sent: wellnessSent }));
  }

  // StreamElements tips: poll REST API for new donations (WebSocket not viable on serverless)
  try {
    await pollStreamElementsTips();
  } catch {
    // non-critical
  }

  // Trivia reminder + auto-close: if a trivia question is active and unanswered for a while,
  // periodically remind chat of the question and eventually close it if nobody answers.
  try {
    const trivia = await kv.get<TriviaState>(TRIVIA_STATE_KEY);
    if (trivia && !trivia.winnerDisplayUntil) {
      const REMINDER_INTERVAL_MS = 90_000; // 90s between reminders
      const FIRST_DELAY_MS = 60_000; // wait at least 60s after trivia starts
      const MAX_REMINDERS = 5;
      const CLOSE_GRACE_MS = 180_000; // wait 3 minutes after last reminder before auto-closing
      const reminderCount = trivia.reminderCount ?? 0;
      const lastReminderAt = trivia.lastReminderAt ?? trivia.startedAt;
      const timeSinceStart = now - trivia.startedAt;
      const timeSinceLast = now - lastReminderAt;

      if (
        reminderCount < MAX_REMINDERS &&
        timeSinceStart >= FIRST_DELAY_MS &&
        timeSinceLast >= REMINDER_INTERVAL_MS
      ) {
        const msg = `Trivia still open: ${trivia.question} — First correct answer wins ${trivia.points} Credits.`;
        try {
          await sendKickChatMessage(accessToken, msg);
          await kv.set<TriviaState>(TRIVIA_STATE_KEY, {
            ...trivia,
            lastReminderAt: now,
            reminderCount: reminderCount + 1,
          });
          sent++;
        } catch {
          // ignore reminder failures
        }
      } else if (
        reminderCount >= MAX_REMINDERS &&
        timeSinceStart >= FIRST_DELAY_MS + REMINDER_INTERVAL_MS &&
        timeSinceLast >= CLOSE_GRACE_MS
      ) {
        // After all reminders have been sent and an extra grace period has passed with no winner,
        // close the trivia so it doesn't run forever.
        const msg = `Trivia closed: ${trivia.question} — No correct answer this time.`;
        try {
          await sendKickChatMessage(accessToken, msg);
        } catch {
          // ignore chat send failures
        }
        // Clear trivia via helper so overlay and modified timestamps stay in sync.
        await setTriviaState(null);
        sent++;
      }
    }
  } catch {
    // Ignore trivia reminder errors — non-critical
  }

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json(
    diagnostic ? { ok: true, sent, debug } : { ok: true, sent }
  );
}
