import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import {
  SPEED_SAMPLE_INTERVAL,
  STALE_THRESHOLD_MS,
  MAX_ENTRIES,
  filterSessionEntries,
  formatAge,
} from './sampling-utils';

export interface SpeedEntry {
  speed: number; // km/h
  timestamp: number;
}

const SPEED_KEY = 'speed_history';

function isWrongTypeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('WRONGTYPE');
}

/**
 * Stores a speed reading using Redis list operations (O(1) vs O(N) read-modify-write).
 * Deduplication: skip if within sample interval and change is < 5 km/h.
 */
export async function storeSpeed(speed: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();

    // Fetch only the last entry to check sample interval — O(1), not O(N).
    const lastRaw = await kv.lrange<SpeedEntry>(SPEED_KEY, -1, -1).catch(async (e) => {
      if (isWrongTypeError(e)) return [];
      throw e;
    });
    const lastEntry = lastRaw[0] ?? null;

    if (lastEntry) {
      const timeSinceLast = ts - lastEntry.timestamp;
      const speedChange = Math.abs(speed - lastEntry.speed);
      if (timeSinceLast < SPEED_SAMPLE_INTERVAL && speedChange < 5) return;
    }

    const entry: SpeedEntry = { speed, timestamp: ts };

    try {
      const pipeline = kv.pipeline();
      pipeline.rpush(SPEED_KEY, entry);
      pipeline.ltrim(SPEED_KEY, -MAX_ENTRIES, -1);
      await pipeline.exec();
    } catch (e) {
      if (isWrongTypeError(e)) {
        await kv.del(SPEED_KEY);
        const pipeline = kv.pipeline();
        pipeline.rpush(SPEED_KEY, entry);
        pipeline.ltrim(SPEED_KEY, -MAX_ENTRIES, -1);
        await pipeline.exec();
      } else {
        throw e;
      }
    }
  } catch (error) {
    console.warn('Failed to store speed:', error);
  }
}

/**
 * Gets speed stats (current, max) for current stream session
 */
export async function getSpeedStats(): Promise<{
  current: { speed: number; age: string } | null;
  max: { speed: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt, streamEndedAt] = await Promise.all([
      kv.lrange<SpeedEntry>(SPEED_KEY, 0, -1).catch(async (e) => {
        if (isWrongTypeError(e)) return await kv.get<SpeedEntry[]>(SPEED_KEY) ?? [];
        throw e;
      }),
      getStreamStartedAt(),
      getStreamEndedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSessionEntries(entries, streamStartedAt, streamEndedAt);

    if (sessionEntries.length === 0) {
      return { current: null, max: null, hasData: false };
    }

    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { speed: mostRecent.speed, age: 'current' }
      : { speed: mostRecent.speed, age: formatAge(ageMs) };

    const speeds = sessionEntries.map(e => e.speed);
    const maxSpeed = Math.max(...speeds);
    const maxEntry = sessionEntries.find(e => e.speed === maxSpeed)!;

    const max = { speed: maxSpeed, age: formatAge(now - maxEntry.timestamp) };

    return { current, max, hasData: true };
  } catch (error) {
    console.warn('Failed to get speed stats:', error);
    return { current: null, max: null, hasData: false };
  }
}
