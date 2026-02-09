// === 📍 RTIRL UTILITIES ===

export interface RTIRLData {
  lat: number | null;
  lon: number | null;
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

  return { lat: baseLat, lon: baseLon, updatedAt, raw: data };
}
