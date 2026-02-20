/**
 * POST: Set location from browser geolocation.
 * Accepts { lat, lon }, reverse geocodes via LocationIQ, updates persistent location.
 * Requires auth (admin page).
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchLocationFromLocationIQ } from '@/utils/api-utils';
import { getLocationForPersistence } from '@/utils/location-utils';
import { updatePersistentLocation } from '@/utils/location-cache';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'set-location-from-browser');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
    }

    const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
    if (!locationiqKey) {
      return NextResponse.json({ error: 'LocationIQ not configured' }, { status: 503 });
    }

    const body = await request.json();
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lon = typeof body.lon === 'number' ? body.lon : null;

    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
    }

    const result = await fetchLocationFromLocationIQ(lat, lon, locationiqKey);
    if (!result.location) {
      return NextResponse.json(
        { error: 'Could not resolve location (e.g. at sea or remote area)' },
        { status: 404 }
      );
    }

    const locationToStore = getLocationForPersistence(result.location);
    if (!locationToStore) {
      return NextResponse.json({ error: 'Invalid location data' }, { status: 400 });
    }

    const now = Date.now();
    // Store timestamp in RTIRL-style format so staleness logic works the same (browser data can become stale)
    const rtirlRaw = { reportedAt: now, updatedAt: now, timestamp: now };
    await updatePersistentLocation({
      location: locationToStore,
      rtirl: { lat, lon, raw: rtirlRaw, updatedAt: now },
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, location: locationToStore });
  } catch (error) {
    console.warn('Failed to set location from browser:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    );
  }
}
