// === 📍 RTIRL UTILITIES ===

export interface RTIRLData {
  lat: number | null;
  lon: number | null;
  /** Speed in km/h (converted from RTIRL's m/s). Null if not provided by RTIRL. */
  speedKmh: number | null;
  /** Altitude in meters (EGM96 preferred, WGS84 fallback). Null if not provided. */
  altitudeM: number | null;
  updatedAt: number | null;
  raw: unknown;
}

/**
 * Fetches RTIRL GPS data
 */
export async function fetchRTIRLData(): Promise<RTIRLData> {
  const rtirlKey = process.env.NEXT_PUBLIC_RTIRL_PULL_KEY;
  if (!rtirlKey) {
    throw new Error('Missing RTIRL_PULL_KEY');
  }

  const response = await fetch(`https://rtirl.com/api/pull?key=${encodeURIComponent(rtirlKey)}`);
  if (!response.ok) {
    throw new Error(`RTIRL error ${response.status}`);
  }

  const data = await response.json();
  const baseLoc = data.location || {};
  const baseLat = baseLoc.latitude ?? data.lat ?? data.latitude ?? null;
  const baseLon = baseLoc.longitude ?? data.lon ?? data.lng ?? data.longitude ?? null;
  const updatedAt = data.updatedAt ?? data.reportedAt ?? null;

  // Speed: RTIRL sends m/s, convert to km/h
  let speedKmh: number | null = null;
  if (typeof data.speed === 'number' && data.speed >= 0) {
    speedKmh = data.speed * 3.6;
  }

  // Altitude: raw number (meters) or object with EGM96/WGS84 (prefer EGM96)
  let altitudeM: number | null = null;
  if (typeof data.altitude === 'number' && data.altitude >= -1000) {
    altitudeM = data.altitude;
  } else if (data.altitude && typeof data.altitude === 'object') {
    const alt = data.altitude as { EGM96?: number; WGS84?: number };
    const v = alt.EGM96 ?? alt.WGS84 ?? null;
    if (typeof v === 'number') altitudeM = v;
  }

  return { lat: baseLat, lon: baseLon, speedKmh, altitudeM, updatedAt, raw: data };
}
