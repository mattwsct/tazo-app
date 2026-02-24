/**
 * Stream goals: subs and kicks accumulated since stream start.
 * Reset when livestream goes live. Used for sub/kicks goal progress bars on overlay.
 */

import { kv } from '@vercel/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';

const STREAM_GOALS_SUBS_KEY = 'stream_goals_subs';
const STREAM_GOALS_KICKS_KEY = 'stream_goals_kicks';

async function ensureSessionStarted(): Promise<void> {
  const started = await getStreamStartedAt();
  if (!started) {
    await onStreamStarted();
  }
}

/** Reset goals and targets when stream starts. */
export async function resetStreamGoalsOnStreamStart(): Promise<void> {
  try {
    await kv.set(STREAM_GOALS_SUBS_KEY, 0);
    await kv.set(STREAM_GOALS_KICKS_KEY, 0);
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

/** Get subs and kicks since stream start. */
export async function getStreamGoals(): Promise<{ subs: number; kicks: number }> {
  try {
    const [subs, kicks] = await kv.mget<[number | null, number | null]>(
      STREAM_GOALS_SUBS_KEY,
      STREAM_GOALS_KICKS_KEY
    );
    return {
      subs: Math.max(0, subs ?? 0),
      kicks: Math.max(0, kicks ?? 0),
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
