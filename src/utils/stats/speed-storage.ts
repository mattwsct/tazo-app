import { kv } from '@/lib/kv';
import { isStreamLive, getStreamStartedAt, getStreamEndedAt } from './stream-state';
import {
  SPEED_SAMPLE_INTERVAL,
  STALE_THRESHOLD_MS,
  MAX_ENTRIES,
  filterSessionEntries,
  cleanOldEntries,
  formatAge,
} from './sampling-utils';

export interface SpeedEntry {
  speed: number; // km/h
  timestamp: number;
}

const SPEED_KEY = 'speed_history';

/**
 * Stores a speed reading with smart sampling
 */
export async function storeSpeed(speed: number, timestamp?: number): Promise<void> {
  try {
    if (!(await isStreamLive())) return;
    const ts = timestamp || Date.now();
    const history = await kv.get<SpeedEntry[]>(SPEED_KEY) || [];

    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const speedChange = Math.abs(speed - lastEntry.speed);

      if (timeSinceLast < SPEED_SAMPLE_INTERVAL && speedChange < 5) {
        return;
      }
    }

    const entry: SpeedEntry = { speed, timestamp: ts };
    history.push(entry);

    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(SPEED_KEY, cleaned);
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
      kv.get<SpeedEntry[]>(SPEED_KEY),
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
