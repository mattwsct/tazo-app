// Validation for update-location API payload

import type { LocationData } from '@/utils/location-utils';
import type { PersistentLocationData } from '@/utils/location-cache';
import type { RTIRLData } from '@/utils/rtirl-utils';

const MAX_STRING_LEN = 100;
const MAX_PAYLOAD_BYTES = 50_000; // 50KB

function isValidString(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_STRING_LEN;
}

function sanitizeLocation(obj: unknown): LocationData | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const location: LocationData = {};
  const stringFields = [
    'country', 'countryCode', 'city', 'state', 'town', 'municipality',
    'suburb', 'neighbourhood', 'quarter', 'province', 'region', 'county',
    'village', 'hamlet', 'district', 'ward', 'borough', 'timezone'
  ];
  for (const key of stringFields) {
    const v = o[key];
    if (isValidString(v)) (location as Record<string, string>)[key] = v;
  }
  return location;
}

function sanitizeRtirl(obj: unknown): RTIRLData | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const lat = typeof o.lat === 'number' && o.lat >= -90 && o.lat <= 90 ? o.lat : null;
  const lon = typeof o.lon === 'number' && o.lon >= -180 && o.lon <= 180 ? o.lon : null;
  if (lat === null || lon === null) return null;
  const updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : Date.now();
  const raw = o.raw ?? o;
  return { lat, lon, updatedAt, raw };
}

/**
 * Validates and sanitizes update-location payload. Returns null if invalid.
 */
export function validateUpdateLocationPayload(body: unknown): PersistentLocationData | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const location = sanitizeLocation(o.location);
  const rtirl = sanitizeRtirl(o.rtirl);
  const updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : Date.now();
  if (!location || !rtirl) return null;
  if (!location.country && !location.countryCode && !location.city && !location.state) {
    return null;
  }
  return { location, rtirl, updatedAt };
}

export const MAX_PAYLOAD_BYTES_EXPORT = MAX_PAYLOAD_BYTES;
