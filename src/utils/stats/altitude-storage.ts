import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import {
  ALTITUDE_SAMPLE_INTERVAL,
  STALE_THRESHOLD_MS,
  MAX_ENTRIES,
  filterSessionEntries,
  cleanOldEntries,
  formatAge,
} from './sampling-utils';

export interface AltitudeEntry {
  altitude: number; // meters
  timestamp: number;
}

const ALTITUDE_KEY = 'altitude_history';

/**
 * Stores an altitude reading with smart sampling
 */
export async function storeAltitude(altitude: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();
    const history = await kv.get<AltitudeEntry[]>(ALTITUDE_KEY) || [];

    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const altitudeChange = Math.abs(altitude - lastEntry.altitude);

      if (timeSinceLast < ALTITUDE_SAMPLE_INTERVAL && altitudeChange < 20) {
        return;
      }
    }

    const entry: AltitudeEntry = { altitude, timestamp: ts };
    history.push(entry);

    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(ALTITUDE_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store altitude:', error);
  }
}

/**
 * Gets altitude stats (current, highest, lowest) for current stream session
 */
export async function getAltitudeStats(): Promise<{
  current: { altitude: number; age: string } | null;
  highest: { altitude: number; age: string } | null;
  lowest: { altitude: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt, streamEndedAt] = await Promise.all([
      kv.get<AltitudeEntry[]>(ALTITUDE_KEY),
      getStreamStartedAt(),
      getStreamEndedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSessionEntries(entries, streamStartedAt, streamEndedAt);

    if (sessionEntries.length === 0) {
      return { current: null, highest: null, lowest: null, hasData: false };
    }

    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { altitude: mostRecent.altitude, age: 'current' }
      : { altitude: mostRecent.altitude, age: formatAge(ageMs) };

    const altitudes = sessionEntries.map(e => e.altitude);
    const highestAlt = Math.max(...altitudes);
    const lowestAlt = Math.min(...altitudes);

    const highestEntry = sessionEntries.find(e => e.altitude === highestAlt)!;
    const lowestEntry = sessionEntries.find(e => e.altitude === lowestAlt)!;

    const highest = { altitude: highestAlt, age: formatAge(now - highestEntry.timestamp) };
    const lowest = { altitude: lowestAlt, age: formatAge(now - lowestEntry.timestamp) };

    return { current, highest, lowest, hasData: true };
  } catch (error) {
    console.warn('Failed to get altitude stats:', error);
    return { current: null, highest: null, lowest: null, hasData: false };
  }
}
