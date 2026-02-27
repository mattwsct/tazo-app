/**
 * Poll state in KV. Used by webhook and settings-stream.
 */

import { kv } from '@vercel/kv';
import type { PollState, QueuedPoll, PollSettings } from '@/types/poll';
import {
  POLL_STATE_KEY,
  POLL_MODIFIED_KEY,
  POLL_QUEUE_KEY,
  POLL_SETTINGS_KEY,
  LAST_POLL_ENDED_AT_KEY,
  DEFAULT_POLL_SETTINGS,
} from '@/types/poll';
import { broadcastPollAndSettings } from '@/lib/poll-broadcast';

const POLL_END_LOCK_KEY = 'poll_end_lock';

/** Record that a poll ended (for auto-start: no poll run in X min). */
export async function setLastPollEndedAt(): Promise<void> {
  await kv.set(LAST_POLL_ENDED_AT_KEY, Date.now());
}

/** Try to acquire lock for ending a poll. Only one process can end+pop+start. Returns true if acquired. */
export async function tryAcquirePollEndLock(): Promise<boolean> {
  try {
    const result = await kv.set(POLL_END_LOCK_KEY, Date.now().toString(), { nx: true, ex: 10 });
    return result !== null && result !== undefined;
  } catch {
    return false;
  }
}

export async function getPollState(): Promise<PollState | null> {
  return kv.get<PollState>(POLL_STATE_KEY);
}

/** Batch read settings + state in 1 KV command. Use in hot paths (webhook) to reduce ops. */
export async function getPollStateAndSettings(): Promise<{ state: PollState | null; settings: PollSettings }> {
  const [storedSettings, state] = await kv.mget<[Partial<PollSettings> | null, PollState | null]>(
    POLL_SETTINGS_KEY,
    POLL_STATE_KEY
  );
  const settings: PollSettings = { ...DEFAULT_POLL_SETTINGS, ...(storedSettings ?? {}) };
  return { state: state ?? null, settings };
}

const AUTO_GAME_LAST_AT_KEY = 'auto_game_last_at';

export async function setPollState(state: PollState | null): Promise<void> {
  const updates: Promise<unknown>[] = [
    kv.set(POLL_STATE_KEY, state),
    kv.set(POLL_MODIFIED_KEY, Date.now()),
  ];
  // Track when poll ends for auto-start (no poll run in X min)
  if (state === null || state.status === 'winner') {
    updates.push(kv.set(LAST_POLL_ENDED_AT_KEY, Date.now()));
  }
  // When a poll naturally ends (reaches winner state), start the cooldown
  // so the next auto game waits the configured interval after this poll finishes.
  if (state?.status === 'winner') {
    updates.push(kv.set(AUTO_GAME_LAST_AT_KEY, String(Date.now())));
  }
  await Promise.all(updates);
  // Fire-and-forget broadcast so overlays get instant updates (no await to avoid adding latency)
  void broadcastPollAndSettings();
}

export async function getPollQueue(): Promise<QueuedPoll[]> {
  const q = await kv.get<QueuedPoll | QueuedPoll[]>(POLL_QUEUE_KEY);
  if (!q) return [];
  return Array.isArray(q) ? q : [q];
}

export async function setPollQueue(queue: QueuedPoll[]): Promise<void> {
  await kv.set(POLL_QUEUE_KEY, queue.length > 0 ? queue : []);
}

/** Pop and return the first queued poll, or null if empty. */
export async function popPollQueue(): Promise<QueuedPoll | null> {
  const queue = await getPollQueue();
  if (queue.length === 0) return null;
  const [first, ...rest] = queue;
  await setPollQueue(rest);
  return first;
}

export async function getPollSettings(): Promise<PollSettings> {
  const stored = await kv.get<Partial<PollSettings> & { chatIdleMinutes?: number }>(POLL_SETTINGS_KEY);
  const merged = { ...DEFAULT_POLL_SETTINGS, ...stored };
  // Migrate legacy chatIdleMinutes -> minutesSinceLastPoll
  if (merged.minutesSinceLastPoll == null && typeof stored?.chatIdleMinutes === 'number') {
    merged.minutesSinceLastPoll = stored.chatIdleMinutes;
  }
  return merged;
}

export async function setPollSettings(settings: Partial<PollSettings>): Promise<void> {
  const current = await getPollSettings();
  const merged = { ...current, ...settings };
  await kv.set(POLL_SETTINGS_KEY, merged);
}
