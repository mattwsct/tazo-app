/**
 * Shared stats broadcast chat logic (HR, speed, altitude).
 *
 * Motivation:
 * - Reduce duplication between cron and realtime ingestion.
 * - Make "why didn't it send?" easier to reason about.
 *
 * Sources:
 * - Cron runs every 1 minute (fallback).
 * - `/api/stats/update` can trigger this immediately (primary).
 */

import { kv } from '@/lib/kv';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { getAltitudeStats, getHeartrateStats, getSpeedStats, isStreamLive } from '@/utils/stats-storage';
import { loadKickAlertSettings } from '@/lib/kick-alert-settings';
import { getBroadcastState, setBroadcastState } from '@/lib/kick-broadcast-state';

type HeartrateBroadcastState = 'below' | 'high' | 'very_high';

export type StatsBroadcastSource = 'cron' | 'stats_update';

export type StatsBroadcastCurrent = {
  speedKmh?: number;
  altitudeM?: number;
  heartrateBpm?: number;
};

function asNumberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export async function checkStatsBroadcastsAndSendChat(args?: {
  source?: StatsBroadcastSource;
  current?: StatsBroadcastCurrent;
}): Promise<number> {
  const source: StatsBroadcastSource = args?.source ?? 'cron';
  const current = args?.current ?? {};

  const storedAlert = await loadKickAlertSettings();

  const chatBroadcastHeartrate = storedAlert?.chatBroadcastHeartrate === true;
  const chatBroadcastSpeed = storedAlert?.chatBroadcastSpeed === true;
  const chatBroadcastAltitude = storedAlert?.chatBroadcastAltitude === true;

  if (!chatBroadcastHeartrate && !chatBroadcastSpeed && !chatBroadcastAltitude) return 0;

  // Live/token gate is only for *sending*. We still allow HR state reset (below threshold)
  // even if not live so the next live crossing triggers correctly.
  const [token, live] = await Promise.all([getValidAccessToken(), isStreamLive()]);
  if (!live) console.log('[Stats Broadcast] Skip: stream not live', JSON.stringify({ source }));
  if (!token) console.log('[Stats Broadcast] Skip: no Kick token', JSON.stringify({ source }));

  const now = Date.now();
  let sent = 0;

  const broadcastState = await getBroadcastState();

  // ----- Heart rate (threshold crossing; gated by state + cooldown) -----
  if (chatBroadcastHeartrate) {
    const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
    let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
    if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1;

    let state: HeartrateBroadcastState =
      broadcastState.heartrate?.state === 'below' ||
      broadcastState.heartrate?.state === 'high' ||
      broadcastState.heartrate?.state === 'very_high'
        ? broadcastState.heartrate.state
        : 'below';

    const lastHrSentAt = asNumberOrZero(broadcastState.heartrate?.lastSentAt);
    const HIGH_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between "high" messages
    const VERY_HIGH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between "very high" messages

    let bpm = asNumberOrZero(current.heartrateBpm);
    let hasData = bpm > 0;
    if (!hasData && source === 'cron') {
      const hrStats = await getHeartrateStats();
      bpm = hrStats.current?.bpm ?? 0;
      hasData = hrStats.hasData && bpm > 0;
    }

    // State reset should happen regardless of live/token so future crossings can fire.
    if (bpm < minBpm) {
      if (state !== 'below') {
        state = 'below';
        // Release claims so the next real crossing can fire immediately.

        await Promise.all([
          kv.del('hr_broadcast_claim:high'),
          kv.del('hr_broadcast_claim:very_high'),
        ]);
        await setBroadcastState({ heartrate: { state, lastSentAt: broadcastState.heartrate?.lastSentAt } });
      }
    } else if (!hasData) {
      // no-op
    } else if (!live || !token) {
      // Stream not live or token missing — do not send, but leave state unchanged.
    } else if (bpm >= veryHighBpm) {
      const cooldownOk = now - lastHrSentAt >= VERY_HIGH_COOLDOWN_MS;
      if (state !== 'very_high' && cooldownOk) {
        // Atomic claim — prevents duplicate sends when multiple overlay tabs post simultaneously.

        const claimed = await kv.set('hr_broadcast_claim:very_high', 1, { nx: true, ex: Math.ceil(VERY_HIGH_COOLDOWN_MS / 1000) });
        if (claimed !== null) {
          const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
          try {
            await sendKickChatMessage(token, msg);
            sent++;
            state = 'very_high';
            await setBroadcastState({ heartrate: { state, lastSentAt: now } });
            console.log('[Stats Broadcast] CHAT_SENT', JSON.stringify({ type: 'heartrate_very_high', bpm, source }));
          } catch (err) {
            console.error('[Stats Broadcast] CHAT_FAIL', JSON.stringify({ type: 'heartrate_very_high', source, error: err instanceof Error ? err.message : String(err) }));
          }
        }
      }
    } else {
      const cooldownOk = now - lastHrSentAt >= HIGH_COOLDOWN_MS;
      if (state === 'below' && cooldownOk) {
        // Atomic claim — prevents duplicate sends when multiple overlay tabs post simultaneously.

        const claimed = await kv.set('hr_broadcast_claim:high', 1, { nx: true, ex: Math.ceil(HIGH_COOLDOWN_MS / 1000) });
        if (claimed !== null) {
          const msg = `❤️ High heart rate: ${bpm} BPM`;
          try {
            await sendKickChatMessage(token, msg);
            sent++;
            state = 'high';
            await setBroadcastState({ heartrate: { state, lastSentAt: now } });
            console.log('[Stats Broadcast] CHAT_SENT', JSON.stringify({ type: 'heartrate_high', bpm, source }));
          } catch (err) {
            console.error('[Stats Broadcast] CHAT_FAIL', JSON.stringify({ type: 'heartrate_high', source, error: err instanceof Error ? err.message : String(err) }));
          }
        }
      } else if (state === 'very_high' && bpm < veryHighBpm) {
        // Drop from very_high to high without sending another message; cooldown still enforced.
        state = 'high';
        await setBroadcastState({ heartrate: { state, lastSentAt: broadcastState.heartrate?.lastSentAt } });
      }
    }

  }

  // ----- Speed -----
  if (chatBroadcastSpeed) {
    if (!live || !token) return sent;
    const minKmh = (storedAlert?.chatBroadcastSpeedMinKmh as number) ?? 20;
    const timeoutMin = (storedAlert?.chatBroadcastSpeedTimeoutMin as number) ?? 5;
    const timeoutMs = timeoutMin * 60 * 1000;

    const lastSentAt = asNumberOrZero(broadcastState.speed?.lastSentAt);
    const lastAnnouncedTop = asNumberOrZero(broadcastState.speed?.lastAnnouncedTop);
    const timeoutOk = now - lastSentAt >= timeoutMs;

    let currentKmh = asNumberOrZero(current.speedKmh);
    let topKmh = currentKmh;
    let hasData = currentKmh > 0;
    if (!hasData && source === 'cron') {
      const stats = await getSpeedStats();
      currentKmh = stats.current?.speed ?? 0;
      topKmh = stats.max?.speed ?? 0;
      hasData = stats.hasData;
    }

    if (hasData) {
      const isNewTop = topKmh > lastAnnouncedTop && topKmh >= minKmh;

      // New-top message only (matches admin label: "Speed — new top speed above min").
      // We intentionally do NOT send periodic "Speed: X km/h" updates to avoid chat spam
      // when cruising at roughly the same speed.
      if (timeoutOk && isNewTop) {
        const claimed = await kv.set(`speed_broadcast_claim:${Math.round(topKmh)}`, 1, { nx: true, ex: Math.ceil(timeoutMs / 1000) });
        if (claimed !== null) {
          const msg = `🚀 New top speed: ${Math.round(topKmh)} km/h!`;
          try {
            await sendKickChatMessage(token, msg);
            sent++;
            await setBroadcastState({ speed: { lastSentAt: now, lastAnnouncedTop: topKmh } });
            console.log('[Stats Broadcast] CHAT_SENT', JSON.stringify({ type: 'speed_top', topKmh, source }));
          } catch (err) {
            console.error('[Stats Broadcast] CHAT_FAIL', JSON.stringify({ type: 'speed_top', source, error: err instanceof Error ? err.message : String(err) }));
          }
        }
      }
    }
  }

  // ----- Altitude -----
  if (chatBroadcastAltitude) {
    if (!live || !token) return sent;
    const minM = (storedAlert?.chatBroadcastAltitudeMinM as number) ?? 50;
    const timeoutMin = (storedAlert?.chatBroadcastAltitudeTimeoutMin as number) ?? 5;
    const timeoutMs = timeoutMin * 60 * 1000;

    const lastSentAt = asNumberOrZero(broadcastState.altitude?.lastSentAt);
    const lastAnnouncedTop = asNumberOrZero(broadcastState.altitude?.lastAnnouncedTop);
    const timeoutOk = now - lastSentAt >= timeoutMs;

    let currentM = asNumberOrZero(current.altitudeM);
    let topM = currentM;
    let hasData = currentM !== 0;
    if (!hasData && source === 'cron') {
      const stats = await getAltitudeStats();
      currentM = stats.current?.altitude ?? 0;
      topM = stats.highest?.altitude ?? 0;
      hasData = stats.hasData;
    }

    if (hasData) {
      const isNewTop = topM > lastAnnouncedTop && topM >= minM;
      if (timeoutOk && isNewTop) {
        const claimed = await kv.set(`altitude_broadcast_claim:${Math.round(topM)}`, 1, { nx: true, ex: Math.ceil(timeoutMs / 1000) });
        if (claimed !== null) {
          const msg = `⛰️ New top altitude: ${Math.round(topM)} m!`;
          try {
            await sendKickChatMessage(token, msg);
            sent++;
            await setBroadcastState({ altitude: { lastSentAt: now, lastAnnouncedTop: topM } });
            console.log('[Stats Broadcast] CHAT_SENT', JSON.stringify({ type: 'altitude_top', topM, source }));
          } catch (err) {
            console.error('[Stats Broadcast] CHAT_FAIL', JSON.stringify({ type: 'altitude_top', source, error: err instanceof Error ? err.message : String(err) }));
          }
        }
      }
    }
  }

  return sent;
}

