/**
 * Stream goals: subs and kicks accumulated since stream start.
 * Reset when livestream goes live. Used for sub/kicks goal progress bars on overlay.
 */

import { kv } from '@vercel/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';

const STREAM_GOALS_SUBS_KEY = 'stream_goals_subs';
const STREAM_GOALS_KICKS_KEY = 'stream_goals_kicks';
const STREAM_TOP_SUB_GIFTERS_KEY = 'stream_top_sub_gifters';
const STREAM_TOP_KICKS_GIFTERS_KEY = 'stream_top_kicks_gifters';

async function ensureSessionStarted(): Promise<void> {
  const started = await getStreamStartedAt();
  if (!started) {
    await onStreamStarted();
  }
}

/** Reset goals and targets when stream starts. */
export async function resetStreamGoalsOnStreamStart(): Promise<void> {
  try {
    await Promise.all([
      kv.set(STREAM_GOALS_SUBS_KEY, 0),
      kv.set(STREAM_GOALS_KICKS_KEY, 0),
      kv.del(STREAM_TOP_SUB_GIFTERS_KEY),
      kv.del(STREAM_TOP_KICKS_GIFTERS_KEY),
    ]);
    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    await kv.set('overlay_settings', {
      ...settings,
      subGoalTarget: 5,
      kicksGoalTarget: 100,
    });
  } catch (e) {
    console.warn('[StreamGoals] Failed to reset:', e);
  }
}

/** Increment subs count (new sub, resub, or gift subs). */
export async function addStreamGoalSubs(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    await ensureSessionStarted();
    const current = (await kv.get<number>(STREAM_GOALS_SUBS_KEY)) ?? 0;
    await kv.set(STREAM_GOALS_SUBS_KEY, current + count);
  } catch (e) {
    console.warn('[StreamGoals] Failed to add subs:', e);
  }
}

/** Increment kicks (100 kicks = $1). Amount is in kicks (integer). */
export async function addStreamGoalKicks(amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    await ensureSessionStarted();
    const current = (await kv.get<number>(STREAM_GOALS_KICKS_KEY)) ?? 0;
    await kv.set(STREAM_GOALS_KICKS_KEY, current + amount);
  } catch (e) {
    console.warn('[StreamGoals] Failed to add kicks:', e);
  }
}

/** Track a sub gifter's contribution this stream. */
export async function trackSubGifter(username: string, count: number): Promise<void> {
  if (!username || count <= 0) return;
  try {
    const data = (await kv.get<Record<string, number>>(STREAM_TOP_SUB_GIFTERS_KEY)) ?? {};
    data[username] = (data[username] ?? 0) + count;
    await kv.set(STREAM_TOP_SUB_GIFTERS_KEY, data);
  } catch (e) {
    console.warn('[StreamGoals] Failed to track sub gifter:', e);
  }
}

/** Track a kicks gifter's contribution this stream. */
export async function trackKicksGifter(username: string, amount: number): Promise<void> {
  if (!username || amount <= 0) return;
  try {
    const data = (await kv.get<Record<string, number>>(STREAM_TOP_KICKS_GIFTERS_KEY)) ?? {};
    data[username] = (data[username] ?? 0) + amount;
    await kv.set(STREAM_TOP_KICKS_GIFTERS_KEY, data);
  } catch (e) {
    console.warn('[StreamGoals] Failed to track kicks gifter:', e);
  }
}

function topFromRecord(
  data: Record<string, number> | null,
  excluded: Set<string>
): { username: string; amount: number } | undefined {
  if (!data) return undefined;
  let best: { username: string; amount: number } | undefined;
  const entries = Object.entries(data)
    .filter(([u]) => !excluded.has((u || '').trim().toLowerCase()))
    .sort(([, a], [, b]) => b - a);
  if (entries.length > 0) {
    const [username, amount] = entries[0];
    best = { username, amount };
  }
  return best;
}

/** Get subs, kicks, and top gifters since stream start. */
export async function getStreamGoals(): Promise<{
  subs: number;
  kicks: number;
  topSubGifter?: { username: string; amount: number };
  topKicksGifter?: { username: string; amount: number };
}> {
  try {
    const [subs, kicks, subGifters, kicksGifters, excluded] = await Promise.all([
      kv.get<number>(STREAM_GOALS_SUBS_KEY),
      kv.get<number>(STREAM_GOALS_KICKS_KEY),
      kv.get<Record<string, number>>(STREAM_TOP_SUB_GIFTERS_KEY),
      kv.get<Record<string, number>>(STREAM_TOP_KICKS_GIFTERS_KEY),
      getLeaderboardExclusions(),
    ]);
    return {
      subs: Math.max(0, subs ?? 0),
      kicks: Math.max(0, kicks ?? 0),
      topSubGifter: topFromRecord(subGifters, excluded),
      topKicksGifter: topFromRecord(kicksGifters, excluded),
    };
  } catch {
    return { subs: 0, kicks: 0 };
  }
}

/** Manually set subs and/or kicks (admin override). */
export async function setStreamGoals(updates: { subs?: number; kicks?: number }): Promise<void> {
  try {
    const promises: Promise<unknown>[] = [];
    if (updates.subs !== undefined) {
      promises.push(kv.set(STREAM_GOALS_SUBS_KEY, Math.max(0, Math.floor(updates.subs))));
    }
    if (updates.kicks !== undefined) {
      promises.push(kv.set(STREAM_GOALS_KICKS_KEY, Math.max(0, Math.floor(updates.kicks))));
    }
    if (promises.length > 0) await Promise.all(promises);
  } catch (e) {
    console.warn('[StreamGoals] Failed to set:', e);
    throw e;
  }
}
