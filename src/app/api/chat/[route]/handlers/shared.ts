import { NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings, LocationDisplayMode } from '@/types/settings';
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export function txtResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}

export function jsonResponse(obj: unknown, status = 200): NextResponse {
  return NextResponse.json(obj, {
    status,
    headers: {
      'cache-control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}

export function requireApiKey(key: string | undefined, name: string): { error: string } | null {
  if (!key) return { error: `${name} API not configured` };
  return null;
}

export interface ChatContext {
  settings: OverlaySettings;
  displayMode: LocationDisplayMode;
  persistentLocation: Awaited<ReturnType<typeof getPersistentLocation>>;
  lat: number | null;
  lon: number | null;
  locationData: Awaited<ReturnType<typeof getLocationData>>;
}

export async function buildChatContext(): Promise<ChatContext> {
  const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
  const displayMode = settings.locationDisplay;
  const persistentLocation = await getPersistentLocation();

  let locationData = null;
  let lat: number | null = null;
  let lon: number | null = null;

  if (persistentLocation) {
    lat = persistentLocation.rtirl.lat;
    lon = persistentLocation.rtirl.lon;
  } else {
    const freshData = await getLocationData();
    if (freshData && freshData.rtirl.lat && freshData.rtirl.lon) {
      lat = freshData.rtirl.lat;
      lon = freshData.rtirl.lon;
      locationData = freshData;
    }
  }

  return { settings, displayMode, persistentLocation, lat, lon, locationData };
}
