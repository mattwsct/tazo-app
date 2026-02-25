/**
 * Vercel Cron: Sends location and/or heart rate updates to Kick chat when enabled.
 * Pushes stream title updates when location changes and autoUpdateLocation is on.
 * Runs every 1 minute.
 *
 * Location (unified): Stream title + chat both run only when live, at most every N min (configurable).
 * - Stream title: when autoUpdateLocation is on
 * - Chat: when chatBroadcastLocation is on (toggle)
 *
 * Heart rate: high/very-high warning on threshold crossing. No spam until HR drops below, then exceeds again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import type { LocationDisplayMode } from '@/types/settings';
import { getHeartrateStats, getSpeedStats, getAltitudeStats, isStreamLive } from '@/utils/stats-storage';
import {
  getStepsSinceStreamStart,
  getDistanceSinceStreamStart,
  getFlightsSinceStreamStart,
  getActiveCaloriesSinceStreamStart,
  getWellnessMilestonesLastSent,
  setWellnessMilestoneLastSent,
} from '@/utils/wellness-storage';
import { getCountryFlagEmoji } from '@/utils/chat-utils';
import { getLocationData } from '@/utils/location-cache';
import { isNotableWeatherCondition, getWeatherEmoji, formatTemperature, isNightTime, isHighUV, isPoorAirQuality } from '@/utils/weather-chat';
import { getStreamTitleLocationPart, buildStreamTitle } from '@/utils/stream-title-utils';

import { KICK_API_BASE, KICK_STREAM_TITLE_SETTINGS_KEY, getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import {
  checkAndResolveExpiredHeist, resolveRaffle, getRaffleReminder, resolveTopChatter,
  resolveExpiredTazoDrop, resolveChatChallenge,
  resolveExpiredBoss, getBossReminder,
  shouldStartAnyAutoGame, pickAndStartAutoGame,
} from '@/utils/gambling-storage';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';
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

// Milestones for 48h+ streams — steps/distance can exceed limits
const WELLNESS_MILESTONES = {
  steps: [1000, 2000, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000],
  distanceKm: [1, 2, 5, 10, 15, 20, 25, 30, 50, 75, 100],
  flightsClimbed: [5, 10, 25, 50, 75, 100, 150],
  activeCalories: [100, 250, 500, 1000, 1500, 2000, 3000, 5000],
} as const;

type HeartrateBroadcastState = 'below' | 'high' | 'very_high';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

  const [storedAlert, lastLocationAt, lastLocationMsg, hrState, overlaySettings, streamTitleSettings, speedLastSent, speedLastTop, altitudeLastSent, altitudeLastTop, weatherLastCondition, kvIsLive] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<HeartrateBroadcastState>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<{ locationDisplay?: string; customLocation?: string; autoRaffleEnabled?: boolean; chipDropsEnabled?: boolean; chatChallengesEnabled?: boolean; bossEventsEnabled?: boolean; autoGameIntervalMin?: number }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_TOP_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_TOP_KEY),
    kv.get<string>(KICK_BROADCAST_WEATHER_LAST_CONDITION_KEY),
    isStreamLive(),
  ]);

  const now = Date.now();
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1; // Disable very-high tier if not above high
  let currentHrState: HeartrateBroadcastState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

  let sent = 0;
  const debug: Record<string, unknown> = diagnostic ? { tokenPresent: true } : {} as Record<string, unknown>;

  // Live status from KV (set by webhook, reliable)
  const isLive = kvIsLive;
  if (diagnostic) debug.isLive = isLive;

  // Fetch current stream title (needed for location-in-title updates)
  let currentTitle = '';
  try {
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      const ch = (channelData.data ?? [])[0];
      currentTitle = (ch?.stream_title ?? '').trim();
    }
  } catch { /* ignore */ }
  console.log('[Cron HR] LIVE_CHECK', JSON.stringify({ isLive, currentTitle: currentTitle.slice(0, 50) }));

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

  // Chat challenges: always resolve, only auto-start when live
  try {
    const challengeResult = await resolveChatChallenge();
    if (challengeResult) {
      await sendKickChatMessage(accessToken, challengeResult);
      sent++;
    }
  } catch (err) {
    console.error('[Cron HR] CHAT_CHALLENGE_RESOLVE_FAIL', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
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
    const shouldStart = await shouldStartAnyAutoGame(overlaySettings ?? undefined);
    if (diagnostic) Object.assign(debug, { autoGameShouldStart: shouldStart });
    if (shouldStart && isLive) {
      const announcement = await pickAndStartAutoGame(overlaySettings ?? {});
      if (announcement) {
        try {
          await sendKickChatMessage(accessToken, announcement);
          sent++;
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'auto_game_start', msgPreview: announcement.slice(0, 80) }));
        } catch (sendErr) {
          await kv.del('raffle_active');
          await kv.del('chip_drop_active');
          await kv.del('chat_challenge_active');
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

  // Unified location: stream title + chat — both only when live, at most every N min
  const autoUpdateLocation = streamTitleSettings?.autoUpdateLocation !== false;
  const chatBroadcastStreamTitle = storedAlert?.chatBroadcastStreamTitle === true;
  const chatBroadcastLocation = storedAlert?.chatBroadcastLocation === true;
  const intervalMin = (storedAlert?.chatBroadcastLocationIntervalMin as number) ?? 5;
  const intervalMs = intervalMin * 60 * 1000;
  const wantsLocationUpdate = autoUpdateLocation || chatBroadcastLocation;

  if (wantsLocationUpdate && isLive) {
      const persistent = await getPersistentLocation();
      const lastAt = typeof lastLocationAt === 'number' ? lastLocationAt : 0;
      const intervalOk = now - lastAt >= intervalMs;

      if (persistent?.location && intervalOk) {
        const includeLocationInTitle = streamTitleSettings?.includeLocationInTitle !== false;
        const displayMode = (overlaySettings?.locationDisplay as LocationDisplayMode) ?? 'city';
        const customLoc = (overlaySettings?.customLocation as string) ?? '';
        const formattedForTitle = getStreamTitleLocationPart(
          persistent.location,
          displayMode,
          customLoc,
          includeLocationInTitle
        );
        let formattedForChat: string | null = null;
        if (displayMode !== 'hidden') {
          const formatted = formatLocation(persistent.location, displayMode);
          const parts: string[] = [];
          if (formatted.primary?.trim()) parts.push(formatted.primary.trim());
          if (formatted.secondary?.trim()) parts.push(formatted.secondary.trim());
          const flag = persistent.location.countryCode ? getCountryFlagEmoji(persistent.location.countryCode.toUpperCase()) : '';
          const locationStr = parts.length > 0 ? `${flag} ${parts.join(', ')}` : null;
          formattedForChat = locationStr ? `Tazo has moved to ${locationStr}` : null;
        }

        const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
        const newFullTitle = formattedForTitle ? buildStreamTitle(customTitle, formattedForTitle) : '';
        const titleChanged = formattedForTitle && newFullTitle !== currentTitle;
        // Use formattedForTitle as dedup key so we don't re-send when location unchanged
        const locationAnnouncedChanged = formattedForTitle && formattedForTitle !== lastLocationMsg;
        const locationChanged = titleChanged || locationAnnouncedChanged;

        if (locationChanged) {
          if (autoUpdateLocation && titleChanged && formattedForTitle && newFullTitle) {
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
          let lastMsgToStore = formattedForTitle ?? '';
          const shouldAnnounce = (chatBroadcastStreamTitle && titleChanged && newFullTitle) || (chatBroadcastLocation && locationChanged);
          if (shouldAnnounce) {
            const chatMsg = titleChanged && newFullTitle
              ? (formattedForTitle ? `Stream title updated to "${newFullTitle}" with new location` : `Stream title updated to "${newFullTitle}"`)
              : formattedForChat;
            if (chatMsg) {
              try {
                await sendKickChatMessage(accessToken, chatMsg);
                sent++;
                console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'stream_title', msgPreview: chatMsg.slice(0, 80) }));
              } catch (err) {
                console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'stream_title', error: err instanceof Error ? err.message : String(err) }));
              }
            }
          }
          await kv.set(KICK_BROADCAST_LAST_LOCATION_KEY, now);
          await kv.set(KICK_BROADCAST_LAST_LOCATION_MSG_KEY, lastMsgToStore);
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
    const locationData = await getLocationData(false);
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

  // Wellness milestones: steps, distance, flights, active calories
  // Steps/distance default ON (opt-out via !== false); flights/calories default OFF (opt-in via === true)
  const wellnessStepsOn = storedAlert?.chatBroadcastWellnessSteps !== false;
  const wellnessDistanceOn = storedAlert?.chatBroadcastWellnessDistance !== false;
  const wellnessFlightsOn = storedAlert?.chatBroadcastWellnessFlights === true;
  const wellnessCaloriesOn = storedAlert?.chatBroadcastWellnessActiveCalories === true;
  const hasWellnessToggles = wellnessStepsOn || wellnessDistanceOn || wellnessFlightsOn || wellnessCaloriesOn;
  if (hasWellnessToggles && isLive) {
    const [stepsSince, distanceSince, flightsSince, activeCalSince, milestonesLast] = await Promise.all([
      getStepsSinceStreamStart(),
      getDistanceSinceStreamStart(),
      getFlightsSinceStreamStart(),
      getActiveCaloriesSinceStreamStart(),
      getWellnessMilestonesLastSent(),
    ]);
    console.log('[Cron HR] WELLNESS_CHECK', JSON.stringify({ wellnessStepsOn, wellnessDistanceOn, stepsSince, distanceSince, milestonesLast }));

    const checkAndSend = async (
      toggle: boolean | undefined,
      current: number,
      milestones: readonly number[],
      lastSent: number | undefined,
      metric: 'steps' | 'distanceKm' | 'flightsClimbed' | 'activeCalories',
      emoji: string,
      unit: string,
      fmt: (n: number) => string
    ) => {
      if (!toggle || current <= 0) return;
      const crossed = milestones.filter((m) => current >= m && (lastSent == null || m > lastSent));
      const highest = crossed.length > 0 ? Math.max(...crossed) : null;
      if (highest != null) {
        const msg = `${emoji} ${fmt(current)} ${unit} and counting!`;
        try {
          await sendKickChatMessage(accessToken, msg);
          sent++;
          await setWellnessMilestoneLastSent(metric, highest);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: `wellness_${metric}`, value: highest, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: `wellness_${metric}`, error: err instanceof Error ? err.message : String(err) }));
        }
      }
    };

    await checkAndSend(
      wellnessStepsOn,
      stepsSince,
      WELLNESS_MILESTONES.steps,
      milestonesLast.steps,
      'steps',
      '👟',
      'steps',
      (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
    );
    await checkAndSend(
      wellnessDistanceOn,
      distanceSince,
      WELLNESS_MILESTONES.distanceKm,
      milestonesLast.distanceKm,
      'distanceKm',
      '🚶',
      'km',
      (n) => String(Math.round(n))
    );
    await checkAndSend(
      wellnessFlightsOn,
      flightsSince,
      WELLNESS_MILESTONES.flightsClimbed,
      milestonesLast.flightsClimbed,
      'flightsClimbed',
      '🪜',
      'flights',
      String
    );
    await checkAndSend(
      wellnessCaloriesOn,
      activeCalSince,
      WELLNESS_MILESTONES.activeCalories,
      milestonesLast.activeCalories,
      'activeCalories',
      '🔥',
      'active calories',
      String
    );
  }

  if (!storedAlert?.chatBroadcastHeartrate) {
    if (storedAlert?.chatBroadcastLocation) console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrBroadcast: false, locationBroadcast: true }));
  } else {
    const hrStats = await getHeartrateStats();
    const bpm = hrStats.current?.bpm ?? 0;
    if (!hrStats.hasData || bpm === 0) {
      console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrData: false, hasData: hrStats.hasData, bpm }));
    }

    if (bpm < minBpm) {
      currentHrState = 'below';
      if (hrState !== 'below') console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: '->below', bpm, minBpm }));
    } else if (veryHighBpm > minBpm && bpm >= veryHighBpm) {
      if (currentHrState !== 'very_high') {
        currentHrState = 'very_high';
        if (isLive) {
          const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
          try {
            await sendKickChatMessage(accessToken, msg);
            sent++;
            await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
            console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_very_high', bpm, msgPreview: msg.slice(0, 50) }));
          } catch (err) {
            console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_very_high', error: err instanceof Error ? err.message : String(err) }));
          }
        }
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_very_high', state: currentHrState }));
      }
    } else if (bpm >= minBpm) {
      if (currentHrState === 'below') {
        currentHrState = 'high';
        if (isLive) {
          const msg = `❤️ High heart rate: ${bpm} BPM`;
          try {
            await sendKickChatMessage(accessToken, msg);
            sent++;
            await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
            console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_high', bpm, msgPreview: msg.slice(0, 50) }));
          } catch (err) {
            console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_high', error: err instanceof Error ? err.message : String(err) }));
          }
        }
      } else if (currentHrState === 'very_high' && bpm < veryHighBpm) {
        currentHrState = 'high';
        console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: 'very_high->high', bpm }));
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_high', state: currentHrState, bpm }));
      }
    }

    if (currentHrState !== (hrState as HeartrateBroadcastState)) {
      await kv.set(KICK_BROADCAST_HEARTRATE_STATE_KEY, currentHrState);
    }
  }

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json(
    diagnostic ? { ok: true, sent, debug } : { ok: true, sent }
  );
}
