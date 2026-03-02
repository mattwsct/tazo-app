/**
 * Goal auto-bump: when sub/kicks goal is reached, bump the target to the next
 * multiple of the increment that is above the current count.
 * e.g. increment=5, count=7 → new target=10; count=10 → new target=15.
 */

import { kv } from '@/lib/kv';

export type GoalType = 'subs' | 'kicks';

/** Bump goal target. New target = next multiple of increment strictly above currentCount. */
export async function bumpGoalTarget(
  type: GoalType,
  currentTarget: number,
  increment: number,
  currentCount?: number
): Promise<number> {
  const inc = Math.max(1, increment);
  const count = currentCount ?? 0;
  // Next multiple of inc that is strictly above count
  const newTarget = (Math.floor(count / inc) + 1) * inc;
  const targetKey = type === 'subs' ? 'subGoalTarget' : 'kicksGoalTarget';
  try {
    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    await kv.set('overlay_settings', { ...settings, [targetKey]: newTarget });
    // Notify SSE immediately so the overlay updates without waiting for the next poll
    void kv.set('overlay_settings_modified', Date.now()).catch(() => {});
    if (process.env.NODE_ENV === 'development') {
      console.log(`[StreamGoals] Bumped ${type} target ${currentTarget} → ${newTarget} (count=${count})`);
    }
    return newTarget;
  } catch (e) {
    console.warn('[StreamGoals] Failed to bump target:', e);
    return currentTarget;
  }
}
