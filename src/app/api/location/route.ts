/**
 * Location API: GET = read current location, POST = update from overlay/RTIRL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPersistentLocation, updatePersistentLocationIfNewer } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { kv } from '@vercel/kv';
import type { OverlaySettings } from '@/types/settings';
import { validateUpdateLocationPayload, MAX_PAYLOAD_BYTES_EXPORT } from '@/lib/location-payload-validator';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'location');
  if (!success) {
    return NextResponse.json({ location: null }, { status: 429 });
  }
  try {
    const persistentLocation = await getPersistentLocation();
    if (!persistentLocation || !persistentLocation.location) {
      return NextResponse.json({ location: null });
    }
    const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
    const formatted = formatLocation(persistentLocation.location, settings.locationDisplay);
    return NextResponse.json({
      location: {
        primary: formatted.primary || '',
        secondary: formatted.secondary,
        countryCode: persistentLocation.location.countryCode || '',
      },
      rawLocation: persistentLocation.location,
      updatedAt: persistentLocation.updatedAt,
    });
  } catch (error) {
    console.error('Failed to get location:', error);
    return NextResponse.json({ location: null }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'location-update');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES_EXPORT) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const body = JSON.parse(rawBody) as unknown;
    const data = validateUpdateLocationPayload(body);
    if (!data) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const updated = await updatePersistentLocationIfNewer(data);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Failed to update location:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
