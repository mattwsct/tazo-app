import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import { STALE_THRESHOLD_MS, MAX_ENTRIES, filterSessionEntries, formatAge } from './sampling-utils';

export interface HeartrateEntry {
  bpm: number;
  timestamp: number; // Unix timestamp in milliseconds
}

const HEARTRATE_KEY = 'heartrate_history';

function isWrongTypeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('WRONGTYPE');
}

/**
 * Stores a heartrate reading using Redis list operations (O(1) vs O(N) read-modify-write).
 * Every in-range sample is recorded while the stream is live; list is capped at MAX_ENTRIES.
 */
export async function storeHeartrate(bpm: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();
    const entry: HeartrateEntry = { bpm, timestamp: ts };

    if (process.env.NODE_ENV === 'development') {
      console.log('[Store Heartrate] Received:', bpm, 'BPM');
    }

    try {
      const pipeline = kv.pipeline();
      pipeline.rpush(HEARTRATE_KEY, entry);
      pipeline.ltrim(HEARTRATE_KEY, -MAX_ENTRIES, -1);
      await pipeline.exec();
    } catch (e) {
      if (isWrongTypeError(e)) {
        // Old JSON-blob format — clear once and switch to list format.
        await kv.del(HEARTRATE_KEY);
        const pipeline = kv.pipeline();
        pipeline.rpush(HEARTRATE_KEY, entry);
        pipeline.ltrim(HEARTRATE_KEY, -MAX_ENTRIES, -1);
        await pipeline.exec();
      } else {
        throw e;
      }
    }
  } catch (error) {
    console.error('Failed to store heartrate:', error);
  }
}

/**
 * Gets heartrate stats (current, min, max, avg) for current stream session
 */
export async function getHeartrateStats(): Promise<{
  current: { bpm: number; age: string } | null;
  min: { bpm: number; age: string } | null;
  max: { bpm: number; age: string } | null;
  avg: number | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt, streamEndedAt] = await Promise.all([
      kv.lrange<HeartrateEntry>(HEARTRATE_KEY, 0, -1).catch(async (e) => {
        // Fallback to old JSON-blob format during migration window.
        if (isWrongTypeError(e)) return await kv.get<HeartrateEntry[]>(HEARTRATE_KEY) ?? [];
        throw e;
      }),
      getStreamStartedAt(),
      getStreamEndedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSessionEntries(entries, streamStartedAt, streamEndedAt);

    if (sessionEntries.length === 0) {
      return { current: null, min: null, max: null, avg: null, hasData: false };
    }

    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { bpm: mostRecent.bpm, age: 'current' }
      : { bpm: mostRecent.bpm, age: formatAge(ageMs) };

    const bpmValues = sessionEntries.map(e => e.bpm);
    const minBpm = Math.min(...bpmValues);
    const maxBpm = Math.max(...bpmValues);

    const minEntry = sessionEntries.find(e => e.bpm === minBpm)!;
    const maxEntry = sessionEntries.find(e => e.bpm === maxBpm)!;

    const min = { bpm: minBpm, age: formatAge(now - minEntry.timestamp) };
    const max = { bpm: maxBpm, age: formatAge(now - maxEntry.timestamp) };

    const avg = Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length);

    return { current, min, max, avg, hasData: true };
  } catch (error) {
    console.warn('Failed to get heartrate stats:', error);
    return { current: null, min: null, max: null, avg: null, hasData: false };
  }
}
