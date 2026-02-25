/**
 * Goal celebration + auto-bump: when sub/kicks goal is reached, show 100% for a
 * short window, then bump the target by a set amount for the next goal.
 */

import { kv } from '@vercel/kv';

const GOAL_CELEBRATION_KEY = 'stream_goal_celebration';
const CELEBRATION_DURATION_MS = 15_000; // 15s to let gifters see the full bar

export type GoalType = 'subs' | 'kicks';

interface CelebrationState {
  subsUntil?: number;
  kicksUntil?: number;
}

export async function getGoalCelebration(): Promise<CelebrationState> {
  try {
    const raw = await kv.get<CelebrationState>(GOAL_CELEBRATION_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Set celebration window when goal is reached. Returns true if a new celebration was set. */
export async function setGoalCelebrationIfNeeded(
  type: GoalType,
  currentCount: number,
  target: number,
  durationMs?: number
): Promise<boolean> {
  if (currentCount < target) return false;
  try {
    const state = await getGoalCelebration();
    const untilKey = type === 'subs' ? 'subsUntil' : 'kicksUntil';
    const existing = state[untilKey];
    const now = Date.now();
    if (existing != null && existing > now) return false;
    const duration = durationMs != null && durationMs > 0 ? durationMs : CELEBRATION_DURATION_MS;
    await kv.set(GOAL_CELEBRATION_KEY, {
      ...state,
      [untilKey]: now + duration,
    });
    return true;
  } catch (e) {
    console.warn('[StreamGoals] Failed to set celebration:', e);
    return false;
  }
}

/** Bump goal target by increment with smart snap. Returns new target. */
export async function bumpGoalTarget(
  type: GoalType,
  currentTarget: number,
  increment: number,
  currentCount?: number
): Promise<number> {
  const inc = Math.max(1, increment);
  const count = currentCount ?? 0;
  const snapTarget = (Math.floor(count / inc) + 1) * inc;
  const newTarget = Math.max(currentTarget + inc, snapTarget);
  try {
    const state = await getGoalCelebration();
    const untilKey = type === 'subs' ? 'subsUntil' : 'kicksUntil';
    const updated = { ...state, [untilKey]: undefined };
    await kv.set(GOAL_CELEBRATION_KEY, updated);

    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    const targetKey = type === 'subs' ? 'subGoalTarget' : 'kicksGoalTarget';
    await kv.set('overlay_settings', { ...settings, [targetKey]: newTarget });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[StreamGoals] Bumped ${type} target ${currentTarget} → ${newTarget}`);
    }
    return newTarget;
  } catch (e) {
    console.warn('[StreamGoals] Failed to bump target:', e);
    return currentTarget;
  }
}

/** Clear all celebration state (call when stream starts; counts reset to 0). */
export async function clearGoalCelebrationOnStreamStart(): Promise<void> {
  try {
    await kv.set(GOAL_CELEBRATION_KEY, {});
    if (process.env.NODE_ENV === 'development') {
      console.log('[StreamGoals] Celebration cleared on stream start');
    }
  } catch (e) {
    console.warn('[StreamGoals] Failed to clear celebration:', e);
  }
}

/** Check if celebration has ended and we should bump. */
export function shouldBump(
  type: GoalType,
  celebrationUntil: number | undefined,
  currentCount: number,
  target: number
): boolean {
  if (celebrationUntil == null || currentCount < target) return false;
  return Date.now() >= celebrationUntil;
}

export { CELEBRATION_DURATION_MS };
