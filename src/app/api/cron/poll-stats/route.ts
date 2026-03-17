/**
 * Vercel Cron: Server-side polling of RTIRL (location/speed/altitude) and Pulsoid (heart rate).
 * Ensures stats stay fresh when no overlay page is open anywhere.
 * Runs every 1 minute (Vercel cron minimum).
 *
 * When the overlay IS open it continues posting real-time data (faster path).
 * This cron acts as the fallback so the app works without the overlay.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchRTIRLData } from '@/utils/rtirl-utils';
import { updatePersistentRtirlOnly, geocodeFromPersistentAndUpdateCache } from '@/utils/location-cache';
import { storeHeartrate } from '@/utils/stats/heartrate-storage';
import { storeSpeed } from '@/utils/stats/speed-storage';
import { storeAltitude } from '@/utils/stats/altitude-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

// Ignore Pulsoid readings older than this — device is probably off-wrist or disconnected
const PULSOID_MAX_AGE_MS = 5 * 60 * 1000;
// Ignore RTIRL speed/altitude if the GPS fix is older than this — device is probably offline
const RTIRL_MAX_AGE_MS = 5 * 60 * 1000;

async function fetchPulsoidHeartrate(): Promise<{ bpm: number; measuredAt: number } | null> {
  const token = process.env.NEXT_PUBLIC_PULSOID_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch('https://dev.pulsoid.net/api/v1/data/heart_rate/latest', {
      headers: { Authorization: `Bearer ${token}` },
      // Short timeout — cron has a 25s budget shared with RTIRL
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const bpm = data?.data?.heart_rate;
    const measuredAt = data?.measured_at;
    if (typeof bpm !== 'number' || bpm <= 0 || bpm > 300) return null;
    if (typeof measuredAt !== 'number') return null;
    return { bpm, measuredAt };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const results: Record<string, string> = {};

  // Fetch RTIRL and Pulsoid in parallel
  const [rtirlResult, pulsoidResult] = await Promise.allSettled([
    fetchRTIRLData(),
    fetchPulsoidHeartrate(),
  ]);

  // --- RTIRL: location, speed, altitude ---
  if (rtirlResult.status === 'fulfilled') {
    const rtirl = rtirlResult.value;

    if (rtirl.lat != null && rtirl.lon != null) {
      const updatedAt = typeof rtirl.updatedAt === 'number' ? rtirl.updatedAt : now;
      const updated = await updatePersistentRtirlOnly(rtirl, updatedAt);
      results.location = updated ? 'updated' : 'skipped_stale';

      if (updated) {
        // Throttled geocode (nx claim guards against burst; safe to fire-and-forget)
        void geocodeFromPersistentAndUpdateCache().catch(() => {});
      }

      // Only store speed/altitude when the GPS fix itself is fresh
      const rtirlAge = now - (typeof rtirl.updatedAt === 'number' ? rtirl.updatedAt : 0);
      const rtirlFresh = rtirlAge <= RTIRL_MAX_AGE_MS;

      if (rtirlFresh) {
        if (rtirl.speedKmh != null && rtirl.speedKmh >= 0) {
          await storeSpeed(Math.round(rtirl.speedKmh), updatedAt);
          results.speed = `${Math.round(rtirl.speedKmh)} km/h`;
        }
        if (rtirl.altitudeM != null) {
          await storeAltitude(Math.round(rtirl.altitudeM), updatedAt);
          results.altitude = `${Math.round(rtirl.altitudeM)} m`;
        }
      } else {
        results.speed = results.altitude = `skipped_stale_gps (${Math.round(rtirlAge / 1000)}s old)`;
      }
    } else {
      results.location = 'no_coords';
    }
  } else {
    results.location = `error: ${String(rtirlResult.reason)}`;
  }

  // --- Pulsoid: heart rate ---
  if (pulsoidResult.status === 'fulfilled' && pulsoidResult.value) {
    const { bpm, measuredAt } = pulsoidResult.value;
    const age = now - measuredAt;
    if (age <= PULSOID_MAX_AGE_MS) {
      await storeHeartrate(bpm, measuredAt);
      results.heartrate = `${bpm} BPM`;
    } else {
      results.heartrate = `skipped_stale (${Math.round(age / 1000)}s old)`;
    }
  } else if (pulsoidResult.status === 'rejected') {
    results.heartrate = 'error';
  } else {
    results.heartrate = 'no_data';
  }

  console.log('[Cron Poll Stats]', JSON.stringify(results));
  return NextResponse.json({ ok: true, ...results });
}
