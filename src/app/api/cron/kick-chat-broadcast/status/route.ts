/**
 * GET /api/cron/kick-chat-broadcast/status
 * Returns diagnostics for chat broadcast (heart rate, location) - helps debug why messages may not appear.
 * POST with body { resetHrState: true } - clears HR broadcast state so the next threshold crossing will send again.
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyRequestAuth } from '@/lib/api-auth';
import { getHeartrateStats, getSpeedStats, getAltitudeStats, isStreamLive, getStreamStartedAt } from '@/utils/stats-storage';
import { getPersistentLocation } from '@/utils/location-cache';
import { KICK_TOKENS_KEY } from '@/lib/kick-api';
import { getWellnessMilestonesLastSent, getWellnessData } from '@/utils/wellness-storage';
import { kv } from '@/lib/kv';
import { getBroadcastState } from '@/lib/kick-broadcast-state';
import { loadKickAlertSettings } from '@/lib/kick-alert-settings';

const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3600_000)}h ago`;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [storedAlert, hrStats, lastLocationSent, hasKickTokens, streamLive, wellnessMilestones, wellnessData, speedStats, altitudeStats, broadcastState, streamStartedAt] = await Promise.all([
    loadKickAlertSettings(),
    getHeartrateStats(),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get(KICK_TOKENS_KEY).then((t) => !!t),
    isStreamLive(),
    getWellnessMilestonesLastSent(),
    getWellnessData(),
    getSpeedStats(),
    getAltitudeStats(),
    getBroadcastState(),
    getStreamStartedAt(),
  ]);

  const chatBroadcastHeartrate = storedAlert?.chatBroadcastHeartrate === true;
  const chatBroadcastLocation = storedAlert?.chatBroadcastLocation === true;
  const chatBroadcastSpeed = storedAlert?.chatBroadcastSpeed === true;
  const chatBroadcastAltitude = storedAlert?.chatBroadcastAltitude === true;
  const chatBroadcastWeather = storedAlert?.chatBroadcastWeather === true;
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1;

  const currentBpm = hrStats.current?.bpm ?? 0;
  const hrAge = hrStats.current?.age ?? 'no data';
  const currentHrState =
    broadcastState.heartrate?.state === 'below' ||
    broadcastState.heartrate?.state === 'high' ||
    broadcastState.heartrate?.state === 'very_high'
      ? broadcastState.heartrate.state
      : 'below';

  // Would the next cron run send a heart rate message?
  let wouldSendHrMessage = false;
  let hrMessageReason = '';
  if (!chatBroadcastHeartrate) {
    hrMessageReason = 'Heart rate broadcast is disabled';
  } else if (!streamLive) {
    hrMessageReason = 'Stream is not live — HR state will not advance until live';
  } else if (!hrStats.hasData) {
    hrMessageReason = 'No heart rate data — is the overlay open with Pulsoid connected?';
  } else if (currentBpm < minBpm) {
    hrMessageReason = `HR ${currentBpm} BPM is below threshold ${minBpm}`;
  } else if (currentBpm >= veryHighBpm && currentHrState !== 'very_high') {
    wouldSendHrMessage = true;
    hrMessageReason = `Would send "Very high heart rate" (${currentBpm} >= ${veryHighBpm})`;
  } else if (currentBpm >= minBpm && currentHrState === 'below') {
    wouldSendHrMessage = true;
    hrMessageReason = `Would send "High heart rate" (${currentBpm} >= ${minBpm}, first crossing)`;
  } else {
    hrMessageReason = `Already sent — state is ${currentHrState}. HR must drop below ${minBpm} then exceed again to re-trigger.`;
  }

  const persistent = await getPersistentLocation();
  const hasLocation = !!persistent?.location;

  const minKmh = (storedAlert?.chatBroadcastSpeedMinKmh as number) ?? 20;
  const minM = (storedAlert?.chatBroadcastAltitudeMinM as number) ?? 50;
  const topSpeed = speedStats?.max?.speed ?? 0;
  const topAltitude = altitudeStats?.highest?.altitude ?? 0;
  const lastSpeedTop = broadcastState.speed?.lastAnnouncedTop ?? 0;
  const lastAltitudeTop = broadcastState.altitude?.lastAnnouncedTop ?? 0;

  const hrLastRaw = broadcastState.heartrate?.lastSentAt;
  const hrLastSentAt = typeof hrLastRaw === 'number' ? new Date(hrLastRaw).toISOString() : null;
  const hrLastSentAgo = typeof hrLastRaw === 'number' ? formatAgo(Date.now() - hrLastRaw) : null;

  return NextResponse.json({
    stream: {
      isLive: streamLive,
      note: streamLive ? 'Stream is live — all notifications enabled' : 'Stream not detected as live — HR and milestone notifications are blocked',
    },
    heartRate: {
      currentBpm,
      age: hrAge,
      hasData: hrStats.hasData,
      state: currentHrState as string,
      thresholds: { minBpm, veryHighBpm },
      broadcastEnabled: chatBroadcastHeartrate,
      wouldSendMessage: wouldSendHrMessage,
      reason: hrMessageReason,
      lastSentAt: hrLastSentAt,
      lastSentAgo: hrLastSentAgo,
    },
    wellnessMilestones: {
      lastSent: wellnessMilestones,
      today: {
        steps: wellnessData?.steps ?? 0,
        distanceKm: wellnessData?.distanceKm ?? 0,
      },
      note: streamLive ? 'Milestones fire when live and today\'s value crosses the next threshold' : 'Milestones blocked — stream not live',
    },
    location: {
      broadcastEnabled: chatBroadcastLocation,
      hasData: hasLocation,
      lastSentAt: lastLocationSent ? new Date(lastLocationSent).toISOString() : null,
    },
    speed: {
      broadcastEnabled: chatBroadcastSpeed,
      hasData: speedStats?.hasData ?? false,
      topKmh: topSpeed,
      lastAnnouncedTop: lastSpeedTop,
      minKmh,
      note: !chatBroadcastSpeed
        ? 'Speed broadcast is disabled — enable in Kick Alerts to get speed messages'
        : !streamLive
          ? 'Stream not live — speed messages only when live'
          : !(speedStats?.hasData)
            ? 'No speed data — is the overlay sending speed?'
            : topSpeed >= minKmh
              ? 'Would send speed update on next cron run if cooldown passed'
              : `Below minimum (current max ${topSpeed} km/h, min ${minKmh})`,
    },
    altitude: {
      broadcastEnabled: chatBroadcastAltitude,
      hasData: altitudeStats?.hasData ?? false,
      topM: topAltitude,
      lastAnnouncedTop: lastAltitudeTop,
      minM,
      note: !chatBroadcastAltitude
        ? 'Altitude broadcast is disabled — enable in Kick Alerts to get altitude messages'
        : !streamLive
          ? 'Stream not live — altitude messages only when live'
          : !(altitudeStats?.hasData)
            ? 'No altitude data — is the overlay sending altitude?'
            : topAltitude >= minM
              ? 'Would send altitude update on next cron run if cooldown passed'
              : `Below minimum (current max ${topAltitude} m, min ${minM})`,
    },
    weather: {
      broadcastEnabled: chatBroadcastWeather,
      note: !chatBroadcastWeather
        ? 'Weather broadcast is disabled — enable in Kick Alerts for weather updates in chat'
        : !streamLive
          ? 'Stream not live — weather messages only when live'
          : 'Sends when condition becomes notable (rain, snow, storm, fog, high UV, poor AQI).',
    },
    kick: {
      hasTokens: hasKickTokens,
    },
    cron: {
      runsEvery: '1 minute',
      note: 'Cron only runs on deployed app. Local dev does not trigger it.',
    },
    streamSession: {
      startedAt: streamStartedAt != null ? new Date(streamStartedAt).toISOString() : null,
      note: streamStartedAt == null
        ? 'No session — HR/speed/altitude use session data. Cron will set session when it sees stream is live (or ensure Kick webhook fires on go-live).'
        : 'Session active — stats filter by this start time.',
    },
    otherReasonsNoMessages: [
      'Cron not running (check Vercel cron + CRON_SECRET) or no valid Kick token.',
      'Stream not detected as live (Kick webhook or cron channel API).',
      'HR/speed/altitude: need overlay sending data while stream is live; session must be started (cron now heals if API says live).',
      'HR: message only on threshold crossing; after sending, HR must drop below min BPM then exceed again to re-trigger.',
      'Speed/altitude: only when there’s a new top above minimum and cooldown (e.g. 5 min) has passed.',
      'Weather: only when condition becomes notable (rain, snow, storm, fog, high UV, poor AQI).',
      'Kick API can reject sends (rate limit, auth, or API error) — check logs for CHAT_FAIL.',
    ],
  });
}

export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.resetHrState === true) {
    await kv.del('kick_broadcast_state');
    return NextResponse.json({ success: true, message: 'Broadcast state reset. Next threshold crossings will send messages.' });
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}
