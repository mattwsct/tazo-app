// === 📊 STATS UPDATE API ===
// Receives speed, altitude, and heartrate from the overlay.
// Protected by hard physiological/physical range clamps + rate limiting.

import { NextRequest, NextResponse } from 'next/server';
import { storeSpeed, storeAltitude, storeHeartrate } from '@/utils/stats-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Hard physiological/physical bounds — values outside these are rejected regardless of secret.
// These exist as a second layer of defence: even if the secret leaks, absurd injected values
// (e.g. 999999999 BPM) are still rejected.
const BOUNDS = {
  heartrate: { min: 0, max: 300 },   // bpm — max ever recorded ~350; 300 covers all real cases
  speed: { min: 0, max: 500 },        // km/h — 500 covers aircraft; real IRL use tops out ~200
  altitude: { min: -1000, max: 9000 }, // metres — below Dead Sea to above Everest
} as const;

function clamp(value: number, min: number, max: number): number | null {
  if (value < min || value > max) return null;
  return value;
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

    if (speed !== undefined) {
      if (typeof speed === 'number' && speed >= 0) {
        const safe = clamp(speed, BOUNDS.speed.min, BOUNDS.speed.max);
        if (safe !== null) promises.push(storeSpeed(safe));
      } else if (typeof speed === 'object' && speed !== null && typeof speed.speed === 'number') {
        const safe = clamp((speed as { speed: number }).speed, BOUNDS.speed.min, BOUNDS.speed.max);
        if (safe !== null) {
          const ts = (speed as { speed: number; timestamp?: number }).timestamp || Date.now();
          promises.push(storeSpeed(safe, ts));
        }
      }
    }

    if (heartrate !== undefined) {
      if (typeof heartrate === 'number' && heartrate >= 0) {
        const safe = clamp(heartrate, BOUNDS.heartrate.min, BOUNDS.heartrate.max);
        if (safe !== null) promises.push(storeHeartrate(safe));
      } else if (typeof heartrate === 'object' && heartrate !== null && typeof heartrate.bpm === 'number') {
        const safe = clamp((heartrate as { bpm: number }).bpm, BOUNDS.heartrate.min, BOUNDS.heartrate.max);
        if (safe !== null) {
          const ts = (heartrate as { bpm: number; timestamp?: number }).timestamp || Date.now();
          promises.push(storeHeartrate(safe, ts));
        }
      }
    }

    if (altitude !== undefined) {
      if (typeof altitude === 'number') {
        const safe = clamp(altitude, BOUNDS.altitude.min, BOUNDS.altitude.max);
        if (safe !== null) promises.push(storeAltitude(safe));
      } else if (typeof altitude === 'object' && altitude !== null && typeof altitude.altitude === 'number') {
        const safe = clamp((altitude as { altitude: number }).altitude, BOUNDS.altitude.min, BOUNDS.altitude.max);
        if (safe !== null) {
          const ts = (altitude as { altitude: number; timestamp?: number }).timestamp || Date.now();
          promises.push(storeAltitude(safe, ts));
        }
      }
    }

    await Promise.all(promises);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update stats:', error);
    return NextResponse.json({ error: 'Failed to update stats' }, { status: 500 });
  }
}
