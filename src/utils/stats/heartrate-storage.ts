import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import { STALE_THRESHOLD_MS, MAX_ENTRIES, filterSessionEntries, cleanOldEntries, formatAge } from './sampling-utils';

export interface HeartrateEntry {
  bpm: number;
  timestamp: number; // Unix timestamp in milliseconds
}

const HEARTRATE_KEY = 'heartrate_history';

/**
 * Stores a heartrate reading with smart sampling
 */
export async function storeHeartrate(bpm: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();
    const history = await kv.get<HeartrateEntry[]>(HEARTRATE_KEY) || [];

    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const bpmChange = Math.abs(bpm - lastEntry.bpm);

      if (process.env.NODE_ENV === 'development') {
        console.log(
          '[Store Heartrate] Received:',
          bpm,
          'BPM, timeSinceLast:',
          Math.round(timeSinceLast / 1000),
          's, bpmChange:',
          bpmChange,
        );
      }
      // Previously we skipped storing when updates were too frequent with tiny changes.
      // Now we always record every in-range sample while the stream is live so stats/graphs
      // can use the full fidelity of the incoming data. Overall history size is still
      // bounded by MAX_ENTRIES + cleanOldEntries().
    } else if (process.env.NODE_ENV === 'development') {
      console.log('[Store Heartrate] Storing first entry');
    }

    const entry: HeartrateEntry = { bpm, timestamp: ts };
    history.push(entry);

    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(HEARTRATE_KEY, cleaned);

    if (process.env.NODE_ENV === 'development') {
      console.log('[Store Heartrate] Stored successfully. Total entries:', cleaned.length);
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
      kv.get<HeartrateEntry[]>(HEARTRATE_KEY),
      getStreamStartedAt(),
      getStreamEndedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSessionEntries(entries, streamStartedAt, streamEndedAt);

    if (process.env.NODE_ENV === 'development' && sessionEntries.length > 0) {
      console.log('[Heartrate Stats] Session entries:', sessionEntries.length, 'since stream start');
    }

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
