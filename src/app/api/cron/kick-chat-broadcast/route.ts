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
import { getHeartrateStats, getSpeedStats, getAltitudeStats, isStreamLive, setStreamLive, getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';
import {
    resetWellnessDailyMetricsAtMidnight,
  } from '@/utils/wellness-storage';
import { checkWellnessMilestonesAndSendChat } from '@/lib/wellness-milestone-chat';
import { getLocationData } from '@/utils/location-cache';
import { isNotableWeatherCondition, getWeatherEmoji, formatTemperature, isNightTime, isHighUV, isPoorAirQuality } from '@/utils/weather-chat';
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
const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';
const KICK_BROADCAST_LAST_LOCATION_MSG_KEY = 'kick_chat_broadcast_last_location_msg';
const KICK_BROADCAST_HEARTRATE_STATE_KEY = 'kick_chat_broadcast_heartrate_state';
const KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY = 'kick_chat_broadcast_heartrate_last_sent';
const KICK_BROADCAST_SPEED_LAST_SENT_KEY = 'kick_chat_broadcast_speed_last_sent';
const KICK_BROADCAST_SPEED_LAST_TOP_KEY = 'kick_chat_broadcast_speed_last_top';
const KICK_BROADCAST_ALTITUDE_LAST_SENT_KEY = 'kick_chat_broadcast_altitude_last_sent';
const KICK_BROADCAST_ALTITUDE_LAST_TOP_KEY = 'kick_chat_broadcast_altitude_last_top';
const KICK_BROADCAST_WEATHER_LAST_CONDITION_KEY = 'kick_chat_broadcast_weather_last_condition';
const OVERLAY_SETTINGS_KEY = 'overlay_settings';

// Milestones for 48h+ streams — steps/distance can exceed limits (logic in wellness-milestone-chat)

type HeartrateBroadcastState = 'below' | 'high' | 'very_high';

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

  const [storedAlertRaw, lastLocationAt, lastLocationMsg, hrState, overlaySettings, streamTitleSettings, speedLastSent, speedLastTop, altitudeLastSent, altitudeLastTop, weatherLastCondition, kvIsLive, persistentForMidnight] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<HeartrateBroadcastState>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<{ locationDisplay?: string; customLocation?: string; autoRaffleEnabled?: boolean; chipDropsEnabled?: boolean; bossEventsEnabled?: boolean; autoGamesEnabled?: boolean; autoGameIntervalMin?: number; showSubGoal?: boolean; subGoalTarget?: number; showKicksGoal?: boolean; kicksGoalTarget?: number }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_TOP_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_TOP_KEY),
    kv.get<string>(KICK_BROADCAST_WEATHER_LAST_CONDITION_KEY),
    isStreamLive(),
    getPersistentLocation(),
  ]);

  const storedAlert = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlertRaw } as Record<string, unknown>;

  // At midnight local time (timezone from overlay/RTIRL location only), reset steps/distance/calories/flights for the new day
  try {
    const tz = persistentForMidnight?.location?.timezone;
    if (tz) await resetWellnessDailyMetricsAtMidnight(tz);
  } catch (e) {
    console.warn('[Cron HR] Midnight wellness reset check failed:', e);
  }

  const now = Date.now();
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1; // Disable very-high tier if not above high
  let currentHrState: HeartrateBroadcastState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

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
    void setStreamLive(apiIsLive);
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
      await sendKickChatMessage(accessToken, heistResult);
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
      await sendKickChatMessage(accessToken, raffleResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'raffle_resolve', msgPreview: raffleResult.slice(0, 80) }));
    } else {
      const reminder = await getRaffleReminder();
      if (reminder && isLive) {
        await sendKickChatMessage(accessToken, reminder);
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
      await sendKickChatMessage(accessToken, dropResult);
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
      await sendKickChatMessage(accessToken, bossResult);
      sent++;
      console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'boss_resolve', msgPreview: bossResult.slice(0, 80) }));
    }
    const bossReminder = await getBossReminder();
    if (bossReminder && isLive) {
      await sendKickChatMessage(accessToken, bossReminder);
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
          await sendKickChatMessage(accessToken, announcement);
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
        await sendKickChatMessage(accessToken, topChatterResult);
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

  // Speed & altitude broadcasts: only when live, new top above min, and timeout passed
  const chatBroadcastSpeed = storedAlert?.chatBroadcastSpeed === true;
  const chatBroadcastAltitude = storedAlert?.chatBroadcastAltitude === true;

  if (chatBroadcastSpeed && isLive) {
    const minKmh = (storedAlert?.chatBroadcastSpeedMinKmh as number) ?? 20;
    const speedTimeoutMin = (storedAlert?.chatBroadcastSpeedTimeoutMin as number) ?? 5;
    const speedTimeoutMs = speedTimeoutMin * 60 * 1000;
    const speedStats = await getSpeedStats();
    const topSpeed = speedStats.max?.speed ?? 0;
    const lastSent = typeof speedLastSent === 'number' ? speedLastSent : 0;
    const lastTop = typeof speedLastTop === 'number' ? speedLastTop : 0;
    const timeoutOk = now - lastSent >= speedTimeoutMs;
    const isNewTop = topSpeed > lastTop && topSpeed >= minKmh;
    if (timeoutOk && isNewTop && speedStats.hasData) {
      const msg = `🚀 New top speed: ${Math.round(topSpeed)} km/h!`;
      try {
        await sendKickChatMessage(accessToken, msg);
        sent++;
        await kv.set(KICK_BROADCAST_SPEED_LAST_SENT_KEY, now);
        await kv.set(KICK_BROADCAST_SPEED_LAST_TOP_KEY, topSpeed);
        console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'speed', topSpeed, msgPreview: msg.slice(0, 50) }));
      } catch (err) {
        console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'speed', error: err instanceof Error ? err.message : String(err) }));
      }
    }
  }

  if (chatBroadcastAltitude && isLive) {
    const minM = (storedAlert?.chatBroadcastAltitudeMinM as number) ?? 50;
    const altitudeTimeoutMin = (storedAlert?.chatBroadcastAltitudeTimeoutMin as number) ?? 5;
    const altitudeTimeoutMs = altitudeTimeoutMin * 60 * 1000;
    const altitudeStats = await getAltitudeStats();
    const topAltitude = altitudeStats.highest?.altitude ?? 0;
    const lastSent = typeof altitudeLastSent === 'number' ? altitudeLastSent : 0;
    const lastTop = typeof altitudeLastTop === 'number' ? altitudeLastTop : 0;
    const timeoutOk = now - lastSent >= altitudeTimeoutMs;
    const isNewTop = topAltitude > lastTop && topAltitude >= minM;
    if (timeoutOk && isNewTop && altitudeStats.hasData) {
      const msg = `⛰️ New top altitude: ${Math.round(topAltitude)} m!`;
      try {
        await sendKickChatMessage(accessToken, msg);
        sent++;
        await kv.set(KICK_BROADCAST_ALTITUDE_LAST_SENT_KEY, now);
        await kv.set(KICK_BROADCAST_ALTITUDE_LAST_TOP_KEY, topAltitude);
        console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'altitude', topAltitude, msgPreview: msg.slice(0, 50) }));
      } catch (err) {
        console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'altitude', error: err instanceof Error ? err.message : String(err) }));
      }
    }
  }

  // Weather broadcast: notable condition changes only (rain, snow, storm, fog, high UV, poor AQI). Not when clearing.
  const chatBroadcastWeather = storedAlert?.chatBroadcastWeather === true;
  if (chatBroadcastWeather && isLive) {
    const locationData = sharedLocationData ?? await getLocationData(false);
    if (locationData?.weather) {
      const { condition, desc, tempC, uvIndex, aqi } = locationData.weather;
      const condKey = `${condition}|${desc}|uv:${uvIndex ?? 'n'}|aqi:${aqi ?? 'n'}`;
      const lastCond = typeof weatherLastCondition === 'string' ? weatherLastCondition : null;
      const weatherNotable = isNotableWeatherCondition(desc);
      const uvNotable = isHighUV(uvIndex);
      const aqiNotable = isPoorAirQuality(aqi);
      const isNotable = weatherNotable || uvNotable || aqiNotable;
      const isNewNotableChange = isNotable && condKey !== lastCond;
      if (isNewNotableChange) {
        const parts: string[] = [];
        if (weatherNotable) {
          const emoji = getWeatherEmoji(condition, isNightTime());
          parts.push(`${emoji} ${desc}`);
        }
        if (uvNotable) parts.push(`high UV (${uvIndex})`);
        if (aqiNotable) parts.push(`poor air quality (AQI ${aqi})`);
        const mainPart = parts.length > 0 ? parts.join(', ') : 'conditions';
        const msg = `🌤️ Weather update: ${mainPart}, ${formatTemperature(tempC)}`;
        try {
          await sendKickChatMessage(accessToken, msg);
          sent++;
          await kv.set(KICK_BROADCAST_WEATHER_LAST_CONDITION_KEY, condKey);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'weather', cond: desc, uv: uvIndex, aqi, msgPreview: msg.slice(0, 60) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'weather', error: err instanceof Error ? err.message : String(err) }));
        }
      }
    }
  }

  // Wellness milestones: steps, distance, flights, active calories (shared with import route for immediate send)
  const wellnessSent = await checkWellnessMilestonesAndSendChat();
  if (wellnessSent > 0) {
    sent += wellnessSent;
    console.log('[Cron HR] WELLNESS_MILESTONES', JSON.stringify({ sent: wellnessSent }));
  }

  if (!storedAlert?.chatBroadcastHeartrate) {
    console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrBroadcast: false }));
  } else {
    const hrStats = await getHeartrateStats();
    const bpm = hrStats.current?.bpm ?? 0;
    if (!hrStats.hasData || bpm === 0) {
      console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrData: false, hasData: hrStats.hasData, bpm }));
    }

    if (bpm < minBpm) {
      // HR dropped below threshold — always reset state so next crossing triggers a new message
      currentHrState = 'below';
      if (hrState !== 'below') console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: '->below', bpm, minBpm }));
    } else if (!isLive) {
      // Not live — do not advance state. If HR is high while offline, treat it as unseen so the
      // first cron run after going live will correctly fire a message.
      console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'not_live', bpm }));
    } else if (veryHighBpm > minBpm && bpm >= veryHighBpm) {
      if (currentHrState !== 'very_high') {
        currentHrState = 'very_high';
        const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          sent++;
          await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_very_high', bpm, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_very_high', error: err instanceof Error ? err.message : String(err) }));
        }
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_very_high', state: currentHrState }));
      }
    } else if (bpm >= minBpm) {
      if (currentHrState === 'below') {
        currentHrState = 'high';
        const msg = `❤️ High heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          sent++;
          await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_high', bpm, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_high', error: err instanceof Error ? err.message : String(err) }));
        }
      } else if (currentHrState === 'very_high' && bpm < veryHighBpm) {
        currentHrState = 'high';
        console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: 'very_high->high', bpm }));
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_high', state: currentHrState, bpm }));
      }
    }

    // Only save state change when below (always) or when live (sent a message)
    if (currentHrState !== (hrState as HeartrateBroadcastState)) {
      await kv.set(KICK_BROADCAST_HEARTRATE_STATE_KEY, currentHrState);
    }
  }

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json(
    diagnostic ? { ok: true, sent, debug } : { ok: true, sent }
  );
}
