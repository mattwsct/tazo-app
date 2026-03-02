// Validation for update-location API payload.
// Security: only GPS coordinates are accepted from the client — never user-supplied city/country strings.
// Geocoded location text is set exclusively by server-side processes (cron, admin browser endpoint).

import type { RTIRLData } from '@/utils/rtirl-utils';

const MAX_PAYLOAD_BYTES = 50_000; // 50KB

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
 * Validates and sanitizes the overlay location POST payload.
 * Only accepts RTIRL GPS coordinates — location text fields are stripped and ignored.
 * Returns null if the payload is missing or coordinates are invalid.
 */
export function validateUpdateLocationPayload(body: unknown): { rtirl: RTIRLData; updatedAt: number } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;

  // Accept rtirl from the top level or directly (overlay sends { rtirl: {...}, ... })
  const rtirlSource = o.rtirl ?? o;
  const rtirl = sanitizeRtirl(rtirlSource);
  if (!rtirl) return null;

  const updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : Date.now();
  return { rtirl, updatedAt };
}

export const MAX_PAYLOAD_BYTES_EXPORT = MAX_PAYLOAD_BYTES;
