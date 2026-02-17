/**
 * GET /api/cron/kick-chat-broadcast/status
 * Returns diagnostics for chat broadcast (heart rate, location) - helps debug why messages may not appear.
 * POST with body { resetHrState: true } - clears HR broadcast state so the next threshold crossing will send again.
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { getHeartrateStats } from '@/utils/stats-storage';
import { getPersistentLocation } from '@/utils/location-cache';
import { KICK_TOKENS_KEY } from '@/lib/kick-api';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';

const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';
const KICK_BROADCAST_HEARTRATE_STATE_KEY = 'kick_chat_broadcast_heartrate_state';
const KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY = 'kick_chat_broadcast_heartrate_last_sent';

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3600_000)}h ago`;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [storedAlert, hrStats, hrState, hrLastSent, lastLocationSent, hasKickTokens] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    getHeartrateStats(),
    kv.get<string>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<number>(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get(KICK_TOKENS_KEY).then((t) => !!t),
  ]);

  const chatBroadcastHeartrate = storedAlert?.chatBroadcastHeartrate === true;
  const chatBroadcastLocation = storedAlert?.chatBroadcastLocation === true;
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1;

  const currentBpm = hrStats.current?.bpm ?? 0;
  const hrAge = hrStats.current?.age ?? 'no data';
  const currentHrState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

  // Would the next cron run send a heart rate message?
  let wouldSendHrMessage = false;
  let hrMessageReason = '';
  if (!chatBroadcastHeartrate) {
    hrMessageReason = 'Heart rate broadcast is disabled';
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

  const hrLastSentAt = hrLastSent ? new Date(hrLastSent).toISOString() : null;
  const hrLastSentAgo = hrLastSent ? formatAgo(Date.now() - hrLastSent) : null;

  return NextResponse.json({
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
    location: {
      broadcastEnabled: chatBroadcastLocation,
      hasData: hasLocation,
      lastSentAt: lastLocationSent ? new Date(lastLocationSent).toISOString() : null,
    },
    kick: {
      hasTokens: hasKickTokens,
    },
    cron: {
      runsEvery: '2 minutes (Vercel)',
      note: 'Cron only runs on deployed app. Local dev does not trigger it.',
    },
  });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.resetHrState === true) {
    await Promise.all([
      kv.del(KICK_BROADCAST_HEARTRATE_STATE_KEY),
      kv.del(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY),
    ]);
    return NextResponse.json({ success: true, message: 'HR broadcast state reset. Next threshold crossing will send a message.' });
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}
