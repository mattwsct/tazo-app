/**
 * Poll state in KV. Used by webhook and settings-stream.
 */

import { kv } from '@vercel/kv';
import type { PollState, QueuedPoll, PollSettings } from '@/types/poll';
import { POLL_STATE_KEY, POLL_MODIFIED_KEY, POLL_QUEUE_KEY, POLL_SETTINGS_KEY, DEFAULT_POLL_SETTINGS } from '@/types/poll';

export async function getPollState(): Promise<PollState | null> {
  return kv.get<PollState>(POLL_STATE_KEY);
}

export async function setPollState(state: PollState | null): Promise<void> {
  await Promise.all([
    kv.set(POLL_STATE_KEY, state),
    kv.set(POLL_MODIFIED_KEY, Date.now()),
  ]);
}

export async function getPollQueue(): Promise<QueuedPoll | null> {
  return kv.get<QueuedPoll>(POLL_QUEUE_KEY);
}

export async function setPollQueue(queue: QueuedPoll | null): Promise<void> {
  await kv.set(POLL_QUEUE_KEY, queue);
}

export async function getPollSettings(): Promise<PollSettings> {
  const stored = await kv.get<Partial<PollSettings>>(POLL_SETTINGS_KEY);
  return { ...DEFAULT_POLL_SETTINGS, ...stored };
}

export async function setPollSettings(settings: Partial<PollSettings>): Promise<void> {
  const current = await getPollSettings();
  const merged = { ...current, ...settings };
  await kv.set(POLL_SETTINGS_KEY, merged);
}
