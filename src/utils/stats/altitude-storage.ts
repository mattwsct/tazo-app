import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import {
  ALTITUDE_SAMPLE_INTERVAL,
  STALE_THRESHOLD_MS,
  MAX_ENTRIES,
  filterSessionEntries,
  formatAge,
} from './sampling-utils';

export interface AltitudeEntry {
  altitude: number; // meters
  timestamp: number;
}

const ALTITUDE_KEY = 'altitude_history';

function isWrongTypeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('WRONGTYPE');
}

/**
 * Stores an altitude reading using Redis list operations (O(1) vs O(N) read-modify-write).
 * Deduplication: skip if within sample interval and change is < 20m.
 */
export async function storeAltitude(altitude: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();

    // Fetch only the last entry to check sample interval — O(1), not O(N).
    const lastRaw = await kv.lrange<AltitudeEntry>(ALTITUDE_KEY, -1, -1).catch(async (e) => {
      if (isWrongTypeError(e)) return [];
      throw e;
    });
    const lastEntry = lastRaw[0] ?? null;

    if (lastEntry) {
      const timeSinceLast = ts - lastEntry.timestamp;
      const altitudeChange = Math.abs(altitude - lastEntry.altitude);
      if (timeSinceLast < ALTITUDE_SAMPLE_INTERVAL && altitudeChange < 20) return;
    }

    const entry: AltitudeEntry = { altitude, timestamp: ts };

    try {
      const pipeline = kv.pipeline();
      pipeline.rpush(ALTITUDE_KEY, entry);
      pipeline.ltrim(ALTITUDE_KEY, -MAX_ENTRIES, -1);
      await pipeline.exec();
    } catch (e) {
      if (isWrongTypeError(e)) {
        await kv.del(ALTITUDE_KEY);
        const pipeline = kv.pipeline();
        pipeline.rpush(ALTITUDE_KEY, entry);
        pipeline.ltrim(ALTITUDE_KEY, -MAX_ENTRIES, -1);
        await pipeline.exec();
      } else {
        throw e;
      }
    }
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
      kv.lrange<AltitudeEntry>(ALTITUDE_KEY, 0, -1).catch(async (e) => {
        if (isWrongTypeError(e)) return await kv.get<AltitudeEntry[]>(ALTITUDE_KEY) ?? [];
        throw e;
      }),
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
