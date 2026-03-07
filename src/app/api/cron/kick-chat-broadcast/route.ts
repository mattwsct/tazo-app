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
import { getPersistentLocation } from '@/utils/location-cache';
import type { LocationDisplayMode } from '@/types/settings';
import { isStreamLive, getStreamStartedAt, onStreamStarted, healStreamStateFromKickAPI } from '@/utils/stats-storage';
import { checkWellnessMilestonesAndSendChat } from '@/lib/wellness-milestone-chat';
import { checkStatsBroadcastsAndSendChat } from '@/lib/stats-broadcast-chat';
import { getLocationData } from '@/utils/location-cache';
import { getStreamTitleLocationPart, buildStreamTitle } from '@/utils/stream-title-utils';
import { getStreamGoals } from '@/utils/stream-goals-storage';

import { KICK_API_BASE, KICK_STREAM_TITLE_SETTINGS_KEY, getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import {
  checkAndResolveExpiredHeist, resolveRaffle, getRaffleReminder, resolveTopChatter,
  resolveExpiredTazoDrop,
  resolveExpiredBoss, getBossReminder,
  shouldStartAnyAutoGame, pickAndStartAutoGame,
} from '@/utils/gambling-storage';
import { getPollSettings } from '@/lib/poll-store';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';
import { DEFAULT_KICK_ALERT_SETTINGS } from '@/app/api/kick-messages/route';
import { maybeBroadcastWeather, maybeBroadcastWellness, maybeBroadcastStats, sendSystemMessage } from '@/lib/chat-broadcast-service';
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

  const [storedAlertRaw, lastLocationAt, lastLocationMsg, overlaySettings, streamTitleSettings, kvIsLive] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<{ locationDisplay?: string; customLocation?: string; autoRaffleEnabled?: boolean; chipDropsEnabled?: boolean; bossEventsEnabled?: boolean; autoGamesEnabled?: boolean; autoGameIntervalMin?: number; showSubGoal?: boolean; subGoalTarget?: number; showKicksGoal?: boolean; kicksGoalTarget?: number }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    isStreamLive(),
  ]);

  const storedAlert = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlertRaw } as Record<string, unknown>;

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

  // ===== EVENT RESOLUTION & AUTO-START (run first — time-critical, TTL-bound) =====

  // Heist resolution (always attempt, regardless of isLive)
  try {
    const heistResult = await checkAndResolveExpiredHeist();
    if (heistResult) {
      await sendSystemMessage('heist_resolve', heistResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heist_resolve', msgPreview: heistResult.slice(0, 80) }));
    }
  } catch (err) {
    console.error('[Cron HR] HEIST_RESOLVE_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }

  // Raffle: always resolve (even if not live — already-started raffles must pay out)
  try {
    const raffleResult = await resolveRaffle();
    if (raffleResult) {
      await sendSystemMessage('raffle_resolve', raffleResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'raffle_resolve', msgPreview: raffleResult.slice(0, 80) }));
    } else {
      const reminder = await getRaffleReminder();
      if (reminder && isLive) {
        await sendSystemMessage('raffle_resolve', reminder);
        sent++;
      }
    }
  } catch (err) {
    console.error('[Cron HR] RAFFLE_RESOLVE_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }

  // Tazo drops: always resolve, only auto-start when live
  try {
    const dropResult = await resolveExpiredTazoDrop();
    if (dropResult) {
      await sendSystemMessage('tazo_drop_resolve', dropResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'tazo_drop_resolve', msgPreview: dropResult.slice(0, 80) }));
    }
  } catch (err) {
    console.error('[Cron HR] TAZO_DROP_RESOLVE_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }

  // Boss events: always resolve + remind, only auto-start when live
  try {
    const bossResult = await resolveExpiredBoss();
    if (bossResult) {
      await sendSystemMessage('boss_resolve', bossResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'boss_resolve', msgPreview: bossResult.slice(0, 80) }));
    }
    const bossReminder = await getBossReminder();
    if (bossReminder && isLive) {
      await sendSystemMessage('boss_reminder', bossReminder);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'boss_reminder', msgPreview: bossReminder.slice(0, 80) }));
    }
  } catch (err) {
    console.error('[Cron HR] BOSS_RESOLVE_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }

  // Unified auto games: single alternating scheduler
  try {
    const shouldStart = await shouldStartAnyAutoGame(overlaySettings ?? undefined, isLive);
    if (diagnostic) Object.assign(debug, { autoGameShouldStart: shouldStart });
    if (shouldStart) {
      const pollSettings = await getPollSettings();
        const announcement = await pickAndStartAutoGame({ ...(overlaySettings ?? {}), pollDurationSeconds: pollSettings.durationSeconds });
      if (announcement) {
        try {
          await sendSystemMessage('auto_game_start', announcement);
          sent++;
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'auto_game_start', msgPreview: announcement.slice(0, 80) }));
        } catch (sendErr) {
          await kv.del('raffle_active');
          await kv.del('chip_drop_active');
          await kv.del('boss_active');
          console.error('[Cron HR] AUTO_GAME_SEND_FAIL', JSON.stringify({ error: sendErr instanceof Error ? sendErr.message : String(sendErr) }));
        }
      }
    }
  } catch (err) {
    console.error('[Cron HR] AUTO_GAME_START_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }

  // Top chatter: only when live
  if (isLive) {
    try {
      const topChatterResult = await resolveTopChatter();
      if (topChatterResult) {
        await sendSystemMessage('top_chatter', topChatterResult);
        sent++;
        console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'top_chatter', msgPreview: topChatterResult.slice(0, 80) }));
      }
    } catch (err) {
      console.error('[Cron HR] TOP_CHATTER_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

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

  // Unified location: silently update stream title only — no chat announcements for auto-updates
  const autoUpdateLocation = streamTitleSettings?.autoUpdateLocation !== false;
  const intervalMin = (storedAlert?.chatBroadcastLocationIntervalMin as number) ?? 1;
  const intervalMs = intervalMin * 60 * 1000;

  if (autoUpdateLocation && isLive) {
    // Use freshly geocoded location if available, fall back to persistent storage
    const freshLocationData = sharedLocationData?.location?.rawLocationData;
    const persistent = freshLocationData ? null : await getPersistentLocation();
    const locationForTitle = freshLocationData ?? persistent?.location;
    const lastAt = typeof lastLocationAt === 'number' ? lastLocationAt : 0;
    const intervalOk = now - lastAt >= intervalMs;

    if (locationForTitle && intervalOk) {
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
          const kicksTarget = overlaySettings?.kicksGoalTarget ?? 100;
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

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json(
    diagnostic ? { ok: true, sent, debug } : { ok: true, sent }
  );
}
