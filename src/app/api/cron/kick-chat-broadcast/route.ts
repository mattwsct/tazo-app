/**
 * Vercel Cron: Sends location and/or heart rate updates to Kick chat when enabled.
 * Pushes stream title updates when location changes and autoUpdateLocation is on.
 * Runs every 2 minutes.
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
import { getHeartrateStats, getSpeedStats, getAltitudeStats } from '@/utils/stats-storage';
import {
  getWellnessData,
  getStepsSinceStreamStart,
  getDistanceSinceStreamStart,
  getHandwashingSinceStreamStart,
  getWellnessMilestonesLastSent,
  setWellnessMilestoneLastSent,
} from '@/utils/wellness-storage';
import { getCountryFlagEmoji } from '@/utils/chat-utils';
import { getLocationData } from '@/utils/location-cache';
import { isNotableWeatherCondition, getWeatherEmoji, formatTemperature, isNightTime, isHighUV, isPoorAirQuality } from '@/utils/weather-chat';
import { formatLocationForStreamTitle, buildStreamTitle } from '@/utils/stream-title-utils';
import type { StreamTitleLocationDisplay } from '@/utils/stream-title-utils';

import { KICK_API_BASE, KICK_STREAM_TITLE_SETTINGS_KEY, getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
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
  standHours: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18],
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

  const runAt = new Date().toISOString();
  console.log('[Cron HR] CRON_START', JSON.stringify({ runAt }));
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'no_token', runAt }));
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const [storedAlert, lastLocationAt, lastLocationMsg, hrState, overlaySettings, streamTitleSettings, speedLastSent, speedLastTop, altitudeLastSent, altitudeLastTop, weatherLastCondition] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<HeartrateBroadcastState>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<{ locationDisplay?: string }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; locationDisplay?: StreamTitleLocationDisplay; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_SPEED_LAST_TOP_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_ALTITUDE_LAST_TOP_KEY),
    kv.get<string>(KICK_BROADCAST_WEATHER_LAST_CONDITION_KEY),
  ]);

  const now = Date.now();
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1; // Disable very-high tier if not above high
  let currentHrState: HeartrateBroadcastState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

  let sent = 0;

  // Unified location: stream title + chat — both only when live, at most every N min
  const autoUpdateLocation = streamTitleSettings?.autoUpdateLocation !== false;
  const chatBroadcastLocation = storedAlert?.chatBroadcastLocation === true;
  const intervalMin = (storedAlert?.chatBroadcastLocationIntervalMin as number) ?? 5;
  const intervalMs = intervalMin * 60 * 1000;
  const wantsLocationUpdate = autoUpdateLocation || chatBroadcastLocation;

  if (wantsLocationUpdate) {
    let isLive = false;
    let currentTitle = '';
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (channelRes.ok) {
      try {
        const channelData = await channelRes.json();
        const ch = (channelData.data ?? [])[0];
        isLive = !!(ch?.livestream?.is_live ?? ch?.is_live);
        currentTitle = (ch?.stream_title ?? '').trim();
      } catch {
        // ignore
      }
    }

    if (isLive) {
      const persistent = await getPersistentLocation();
      const lastAt = typeof lastLocationAt === 'number' ? lastLocationAt : 0;
      const intervalOk = now - lastAt >= intervalMs;

      if (persistent?.location && intervalOk) {
        const includeLocationInTitle = streamTitleSettings?.includeLocationInTitle !== false;
        const displayForTitle = (streamTitleSettings?.locationDisplay as StreamTitleLocationDisplay) ?? 'state';
        const formattedForTitle = includeLocationInTitle ? formatLocationForStreamTitle(persistent.location, displayForTitle) : '';
        const displayMode = (overlaySettings?.locationDisplay as LocationDisplayMode) || 'city';
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
          if (chatBroadcastLocation && locationChanged) {
            // When title updates with location, combine into one chat message so viewers see the new title
            const chatMsg = titleChanged && newFullTitle
              ? `Stream title updated to "${newFullTitle}" with new location`
              : formattedForChat;
            if (chatMsg) {
              try {
                await sendKickChatMessage(accessToken, chatMsg);
                sent++;
                lastMsgToStore = chatMsg;
                console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'location', msgPreview: chatMsg.slice(0, 80) }));
              } catch (err) {
                console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'location', error: err instanceof Error ? err.message : String(err) }));
              }
            }
          }
          await kv.set(KICK_BROADCAST_LAST_LOCATION_KEY, now);
          await kv.set(KICK_BROADCAST_LAST_LOCATION_MSG_KEY, lastMsgToStore);
        }
      }
    }
  }

  // Speed & altitude broadcasts: only when live, new top above min, and timeout passed
  const chatBroadcastSpeed = storedAlert?.chatBroadcastSpeed === true;
  const chatBroadcastAltitude = storedAlert?.chatBroadcastAltitude === true;
  let speedAltitudeLive = false;
  if (chatBroadcastSpeed || chatBroadcastAltitude) {
    try {
      const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (channelRes.ok) {
        const channelData = await channelRes.json();
        const ch = (channelData.data ?? [])[0];
        speedAltitudeLive = !!(ch?.livestream?.is_live ?? ch?.is_live);
      }
    } catch { /* ignore */ }
  }

  if (chatBroadcastSpeed && speedAltitudeLive) {
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

  if (chatBroadcastAltitude && speedAltitudeLive) {
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
  if (chatBroadcastWeather && speedAltitudeLive) {
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

  // Wellness milestones: steps, distance, stand hours, active calories, handwashing (only when live)
  const hasWellnessToggles =
    storedAlert?.chatBroadcastWellnessSteps ||
    storedAlert?.chatBroadcastWellnessDistance ||
    storedAlert?.chatBroadcastWellnessStandHours ||
    storedAlert?.chatBroadcastWellnessActiveCalories ||
    storedAlert?.chatBroadcastWellnessHandwashing;
  if (hasWellnessToggles && speedAltitudeLive) {
    const [wellness, stepsSince, distanceSince, handwashingSince, milestonesLast] = await Promise.all([
      getWellnessData(),
      getStepsSinceStreamStart(),
      getDistanceSinceStreamStart(),
      getHandwashingSinceStreamStart(),
      getWellnessMilestonesLastSent(),
    ]);

    const checkAndSend = async (
      toggle: boolean | undefined,
      current: number,
      milestones: readonly number[],
      lastSent: number | undefined,
      metric: 'steps' | 'distanceKm' | 'standHours' | 'activeCalories',
      emoji: string,
      unit: string,
      fmt: (n: number) => string
    ) => {
      if (!toggle || current <= 0) return;
      const crossed = milestones.filter((m) => current >= m && (lastSent == null || m > lastSent));
      const highest = crossed.length > 0 ? Math.max(...crossed) : null;
      if (highest != null) {
        const msg = `${emoji} ${fmt(highest)} ${unit} this stream!`;
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

    // Handwashing: notify each time completed (every wash), not at milestones
    const handwashingToggle = storedAlert?.chatBroadcastWellnessHandwashing === true;
    if (handwashingToggle && handwashingSince > 0) {
      const lastHandwashing = milestonesLast.handwashing ?? 0;
      if (handwashingSince > lastHandwashing) {
        const n = handwashingSince;
        const msg = `🧼 ${n} hand wash${n === 1 ? '' : 'es'} completed this stream!`;
        try {
          await sendKickChatMessage(accessToken, msg);
          sent++;
          await setWellnessMilestoneLastSent('handwashing', n);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'wellness_handwashing', value: n, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'wellness_handwashing', error: err instanceof Error ? err.message : String(err) }));
        }
      }
    }

    await checkAndSend(
      storedAlert?.chatBroadcastWellnessSteps === true,
      stepsSince,
      WELLNESS_MILESTONES.steps,
      milestonesLast.steps,
      'steps',
      '👟',
      'steps',
      (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
    );
    await checkAndSend(
      storedAlert?.chatBroadcastWellnessDistance === true,
      distanceSince,
      WELLNESS_MILESTONES.distanceKm,
      milestonesLast.distanceKm,
      'distanceKm',
      '🚶',
      'km',
      (n) => (n % 1 === 0 ? String(n) : n.toFixed(1))
    );
    await checkAndSend(
      storedAlert?.chatBroadcastWellnessStandHours === true,
      wellness?.standHours ?? 0,
      WELLNESS_MILESTONES.standHours,
      milestonesLast.standHours,
      'standHours',
      '🧍',
      'stand hours',
      String
    );
    await checkAndSend(
      storedAlert?.chatBroadcastWellnessActiveCalories === true,
      wellness?.activeCalories ?? 0,
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
        const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'very_high';
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
        const msg = `❤️ High heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'high';
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

    if (currentHrState !== (hrState as HeartrateBroadcastState)) {
      await kv.set(KICK_BROADCAST_HEARTRATE_STATE_KEY, currentHrState);
    }
  }

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json({ ok: true, sent });
}
