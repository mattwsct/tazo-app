import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import {
  LOCATION_SAMPLE_INTERVAL,
  MAX_ENTRIES,
  filterSessionEntries,
  cleanOldEntries,
} from './sampling-utils';

export interface LocationEntry {
  lat: number;
  lon: number;
  timestamp: number;
}

const LOCATION_KEY = 'location_history';

/**
 * Stores a location reading with smart sampling
 */
export async function storeLocation(lat: number, lon: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();
    const history = await kv.get<LocationEntry[]>(LOCATION_KEY) || [];

    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;

      // Calculate distance moved (Haversine formula)
      const R = 6371; // Earth's radius in km
      const dLat = (lat - lastEntry.lat) * Math.PI / 180;
      const dLon = (lon - lastEntry.lon) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lastEntry.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = R * c;

      if (timeSinceLast < LOCATION_SAMPLE_INTERVAL && distanceKm < 0.1) {
        return;
      }
    }

    const entry: LocationEntry = { lat, lon, timestamp: ts };
    history.push(entry);

    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(LOCATION_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store location:', error);
  }
}

/**
 * Calculates distance traveled in current stream session (in km)
 */
export async function getDistanceTraveled(): Promise<number | null> {
  try {
    const [history, streamStartedAt, streamEndedAt] = await Promise.all([
      kv.get<LocationEntry[]>(LOCATION_KEY),
      getStreamStartedAt(),
      getStreamEndedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSessionEntries(entries, streamStartedAt, streamEndedAt);

    if (sessionEntries.length < 2) {
      return null;
    }

    let totalDistance = 0;
    for (let i = 1; i < sessionEntries.length; i++) {
      const prev = sessionEntries[i - 1];
      const curr = sessionEntries[i];

      const R = 6371;
      const dLat = (curr.lat - prev.lat) * Math.PI / 180;
      const dLon = (curr.lon - prev.lon) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      totalDistance += distance;
    }

    return Math.round(totalDistance * 10) / 10;
  } catch (error) {
    console.warn('Failed to calculate distance:', error);
    return null;
  }
}
