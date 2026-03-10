/**
 * Stream goals: subs and kicks accumulated since stream start.
 * Reset when livestream goes live. Used for sub/kicks goal progress bars on overlay.
 */

import { kv } from '@/lib/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';

const STREAM_GOALS_SUBS_KEY = 'stream_goals_subs';
const STREAM_GOALS_KICKS_KEY = 'stream_goals_kicks';
const STREAM_GOALS_DONATIONS_KEY = 'stream_goals_donations_cents';
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
      subGoalSubtext: null,
      showKicksGoal: false,
      kicksGoalTarget: kicksIncrement,
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

/** Increment donations total (in cents) for the current stream. Uses atomic INCRBY. */
export async function addStreamGoalDonations(amountCents: number): Promise<void> {
  if (amountCents <= 0) return;
  try {
    await ensureSessionStarted();
    await kv.incrby(STREAM_GOALS_DONATIONS_KEY, Math.floor(amountCents));
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
  } catch (e) {
    console.warn('[StreamGoals] Failed to add donations:', e);
  }
}

/** Get subs, kicks, and donations since stream start. */
export async function getStreamGoals(): Promise<{ subs: number; kicks: number; donationsCents: number }> {
  try {
    const [subs, kicks, donationsCents] = await Promise.all([
      kv.get<number>(STREAM_GOALS_SUBS_KEY),
      kv.get<number>(STREAM_GOALS_KICKS_KEY),
      kv.get<number>(STREAM_GOALS_DONATIONS_KEY),
    ]);
    return {
      subs: Math.max(0, subs ?? 0),
      kicks: Math.max(0, kicks ?? 0),
      donationsCents: Math.max(0, donationsCents ?? 0),
    };
  } catch {
    return { subs: 0, kicks: 0, donationsCents: 0 };
  }
}

/** Manually set subs, kicks, and/or donations (admin override or chat commands).
 *  NOTE: To avoid mysterious resets from misconfigured callers, we treat an
 *  attempted donationsCents=0 as "no change" when a positive value already
 *  exists. To intentionally clear donations, callers should first ensure the
 *  current value is 0 or use a dedicated reset flow in future.
 */
export async function setStreamGoals(updates: { subs?: number; kicks?: number; donationsCents?: number }): Promise<void> {
  try {
    // Load current donations once so we can guard against accidental resets.
    let currentDonations: number | null = null;
    if (updates.donationsCents !== undefined) {
      const existing = await kv.get<number>(STREAM_GOALS_DONATIONS_KEY);
      currentDonations = Math.max(0, existing ?? 0);
    }

    const promises: Promise<unknown>[] = [];
    if (updates.subs !== undefined) {
      promises.push(kv.set(STREAM_GOALS_SUBS_KEY, Math.max(0, Math.floor(updates.subs))));
    }
    if (updates.kicks !== undefined) {
      promises.push(kv.set(STREAM_GOALS_KICKS_KEY, Math.max(0, Math.floor(updates.kicks))));
    }
    if (updates.donationsCents !== undefined) {
      const next = Math.max(0, Math.floor(updates.donationsCents));
      // Guard: if we already have a positive donations total and someone tries
      // to write 0, assume it's an accidental reset from another environment.
      if (currentDonations != null && currentDonations > 0 && next === 0) {
        console.warn(
          '[StreamGoals] Ignoring donationsCents reset to 0 because currentDonations is',
          currentDonations,
          '- check callers of setStreamGoals / /api/stream-goals in all environments.'
        );
      } else {
        promises.push(kv.set(STREAM_GOALS_DONATIONS_KEY, next));
      }
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
