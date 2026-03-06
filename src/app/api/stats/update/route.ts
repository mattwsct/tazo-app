// === 📊 STATS UPDATE API ===
// Receives speed, altitude, and heartrate from the overlay.
// Protected by hard physiological/physical range clamps + rate limiting.

import { NextRequest, NextResponse } from 'next/server';
import { storeSpeed, storeAltitude, storeHeartrate } from '@/utils/stats-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';
import { checkStatsBroadcastsAndSendChat } from '@/lib/stats-broadcast-chat';

export const dynamic = 'force-dynamic';

const BOUNDS = {
  heartrate: { min: 0, max: 300 },    // bpm — max ever recorded ~350; 300 covers all real cases
  speed: { min: 0, max: 500 },         // km/h — 500 covers aircraft; real IRL use tops out ~200
  altitude: { min: -1000, max: 9000 }, // metres — below Dead Sea to above Everest
  // Timestamps: accept anything within ±60 s of server time to prevent time-series corruption
  timestampSlack: 60_000,
} as const;

function clamp(value: number, min: number, max: number): number | null {
  if (value < min || value > max) return null;
  return value;
}

/** Clamp a client-supplied timestamp to [now - 60s, now + 5s]. */
function clampTs(ts: number | undefined): number {
  const now = Date.now();
  if (ts === undefined || !Number.isFinite(ts)) return now;
  return Math.min(now + 5_000, Math.max(now - BOUNDS.timestampSlack, ts));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { success } = await checkApiRateLimit(request, 'stats-update');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { speed, altitude, heartrate } = body;

    const promises: Promise<void>[] = [];
    let latestSpeedKmh: number | undefined;
    let latestAltitudeM: number | undefined;
    let latestHeartrateBpm: number | undefined;

    if (speed !== undefined) {
      if (typeof speed === 'number' && speed >= 0) {
        const safe = clamp(speed, BOUNDS.speed.min, BOUNDS.speed.max);
        if (safe !== null) {
          latestSpeedKmh = safe;
          promises.push(storeSpeed(safe));
        }
      } else if (typeof speed === 'object' && speed !== null && typeof speed.speed === 'number') {
        const safe = clamp((speed as { speed: number }).speed, BOUNDS.speed.min, BOUNDS.speed.max);
        if (safe !== null) {
          const ts = clampTs((speed as { speed: number; timestamp?: number }).timestamp);
          latestSpeedKmh = safe;
          promises.push(storeSpeed(safe, ts));
        }
      }
    }

    if (heartrate !== undefined) {
      if (typeof heartrate === 'number' && heartrate >= 0) {
        const safe = clamp(heartrate, BOUNDS.heartrate.min, BOUNDS.heartrate.max);
        if (safe !== null) {
          latestHeartrateBpm = safe;
          promises.push(storeHeartrate(safe));
        }
      } else if (typeof heartrate === 'object' && heartrate !== null && typeof heartrate.bpm === 'number') {
        const safe = clamp((heartrate as { bpm: number }).bpm, BOUNDS.heartrate.min, BOUNDS.heartrate.max);
        if (safe !== null) {
          const ts = clampTs((heartrate as { bpm: number; timestamp?: number }).timestamp);
          latestHeartrateBpm = safe;
          promises.push(storeHeartrate(safe, ts));
        }
      }
    }

    if (altitude !== undefined) {
      if (typeof altitude === 'number') {
        const safe = clamp(altitude, BOUNDS.altitude.min, BOUNDS.altitude.max);
        if (safe !== null) {
          latestAltitudeM = safe;
          promises.push(storeAltitude(safe));
        }
      } else if (typeof altitude === 'object' && altitude !== null && typeof altitude.altitude === 'number') {
        const safe = clamp((altitude as { altitude: number }).altitude, BOUNDS.altitude.min, BOUNDS.altitude.max);
        if (safe !== null) {
          const ts = clampTs((altitude as { altitude: number; timestamp?: number }).timestamp);
          latestAltitudeM = safe;
          promises.push(storeAltitude(safe, ts));
        }
      }
    }

    await Promise.all(promises);
    // Fire-and-forget: if stream is live, send chat broadcasts immediately (cooldowns/state apply).
    void checkStatsBroadcastsAndSendChat({
      source: 'stats_update',
      current: {
        speedKmh: latestSpeedKmh,
        altitudeM: latestAltitudeM,
        heartrateBpm: latestHeartrateBpm,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update stats:', error);
    return NextResponse.json({ error: 'Failed to update stats' }, { status: 500 });
  }
}
