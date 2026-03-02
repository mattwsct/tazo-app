/**
 * Stream goals: subs and kicks accumulated since stream start.
 * Reset when livestream goes live. Used for sub/kicks goal progress bars on overlay.
 */

import { kv } from '@/lib/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';

const STREAM_GOALS_SUBS_KEY = 'stream_goals_subs';
const STREAM_GOALS_KICKS_KEY = 'stream_goals_kicks';
// Written whenever goals change — SSE watches this to push updates to the overlay
export const STREAM_GOALS_MODIFIED_KEY = 'stream_goals_modified';

async function ensureSessionStarted(): Promise<void> {
  const started = await getStreamStartedAt();
  if (!started) {
    await onStreamStarted();
  }
}

/** Reset goals and targets when stream starts/ends.
 *  Targets reset to the configured increment (first milestone).
 *  Subtexts (set via !subsgoal / !kicksgoal) are cleared. */
export async function resetStreamGoalsOnStreamStart(): Promise<{ subTarget: number; kicksTarget: number }> {
  try {
    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    const subIncrement = Math.max(1, (settings.subGoalIncrement as number) || 5);
    const kicksIncrement = Math.max(1, (settings.kicksGoalIncrement as number) || 100);
    await Promise.all([
      kv.set(STREAM_GOALS_SUBS_KEY, 0),
      kv.set(STREAM_GOALS_KICKS_KEY, 0),
    ]);
    await kv.set('overlay_settings', {
      ...settings,
      showSubGoal: false,
      subGoalTarget: subIncrement,
      kicksGoalTarget: kicksIncrement,
      showKicksGoal: false,
      subGoalSubtext: null,
      kicksGoalSubtext: null,
    });
    return { subTarget: subIncrement, kicksTarget: kicksIncrement };
  } catch (e) {
    console.warn('[StreamGoals] Failed to reset:', e);
    return { subTarget: 5, kicksTarget: 100 };
  }
}

/** Increment subs count (new sub, resub, or gift subs). Uses atomic INCRBY to prevent race conditions. */
export async function addStreamGoalSubs(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    await ensureSessionStarted();
    await kv.incrby(STREAM_GOALS_SUBS_KEY, count);
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
  } catch (e) {
    console.warn('[StreamGoals] Failed to add subs:', e);
  }
}

/** Increment kicks (100 kicks = $1). Amount is in kicks (integer). Uses atomic INCRBY. */
export async function addStreamGoalKicks(amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    await ensureSessionStarted();
    await kv.incrby(STREAM_GOALS_KICKS_KEY, amount);
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
  } catch (e) {
    console.warn('[StreamGoals] Failed to add kicks:', e);
  }
}

/** Get subs and kicks since stream start. */
export async function getStreamGoals(): Promise<{ subs: number; kicks: number }> {
  try {
    const [subs, kicks] = await Promise.all([
      kv.get<number>(STREAM_GOALS_SUBS_KEY),
      kv.get<number>(STREAM_GOALS_KICKS_KEY),
    ]);
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
    if (promises.length > 0) {
      promises.push(kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()));
      await Promise.all(promises);
    }
  } catch (e) {
    console.warn('[StreamGoals] Failed to set:', e);
    throw e;
  }
}
