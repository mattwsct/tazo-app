/**
 * Stream goals: subs and kicks accumulated since stream start.
 * Reset when livestream goes live. Used for sub/kicks goal progress bars on overlay.
 * Supabase primary (creator_settings.goal_subs / goal_kicks), KV fallback.
 */

import { kv } from '@/lib/kv';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCreatorId } from '@/lib/creator-id';
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

/** Reset goals and targets when stream starts/ends. */
export async function resetStreamGoalsOnStreamStart(): Promise<{ subTarget: number; kicksTarget: number }> {
  try {
    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    const subIncrement = Math.max(1, (settings.subGoalIncrement as number) || 5);
    const kicksIncrement = Math.max(1, (settings.kicksGoalIncrement as number) || 5000);

    // Reset Supabase
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        await supabase.from('creator_settings').update({
          goal_subs: 0,
          goal_kicks: 0,
          goals_updated_at: new Date().toISOString(),
        }).eq('creator_id', creatorId);
      }
    }

    // Reset KV (fallback + fast reads)
    await Promise.all([
      kv.set(STREAM_GOALS_SUBS_KEY, 0),
      kv.set(STREAM_GOALS_KICKS_KEY, 0),
    ]);
    // Apply the stream-start show preference configured in admin.
    const startShowSubGoal = !!(settings.startShowSubGoal);
    const startShowKicksGoal = !!(settings.startShowKicksGoal);
    await kv.set('overlay_settings', {
      ...settings,
      showSubGoal: startShowSubGoal,
      subGoalTarget: subIncrement,
      subGoalSubtext: null,
      showKicksGoal: startShowKicksGoal,
      kicksGoalTarget: kicksIncrement,
      kicksGoalSubtext: null,
    });
    return { subTarget: subIncrement, kicksTarget: kicksIncrement };
  } catch (e) {
    console.warn('[StreamGoals] Failed to reset:', e);
    return { subTarget: 5, kicksTarget: 5000 };
  }
}

/** Increment subs count (new sub, resub, or gift subs). Atomic via RPC. */
export async function addStreamGoalSubs(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    await ensureSessionStarted();
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        await supabase.rpc('increment_stream_goal', { p_creator_id: creatorId, p_field: 'subs', p_amount: count });
        void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
        return;
      }
    }
    // KV fallback
    await kv.incrby(STREAM_GOALS_SUBS_KEY, count);
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
  } catch (e) {
    console.warn('[StreamGoals] Failed to add subs:', e);
  }
}

/** Increment kicks (100 kicks = $1). Amount is in kicks (integer). Atomic via RPC. */
export async function addStreamGoalKicks(amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    await ensureSessionStarted();
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        await supabase.rpc('increment_stream_goal', { p_creator_id: creatorId, p_field: 'kicks', p_amount: amount });
        void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
        return;
      }
    }
    // KV fallback
    await kv.incrby(STREAM_GOALS_KICKS_KEY, amount);
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
  } catch (e) {
    console.warn('[StreamGoals] Failed to add kicks:', e);
  }
}

/** Get subs and kicks since stream start. Supabase primary, KV fallback. */
export async function getStreamGoals(): Promise<{ subs: number; kicks: number }> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data } = await supabase.from('creator_settings')
          .select('goal_subs,goal_kicks')
          .eq('creator_id', creatorId)
          .single();
        if (data) {
          return {
            subs: Math.max(0, Number(data.goal_subs ?? 0)),
            kicks: Math.max(0, Number(data.goal_kicks ?? 0)),
          };
        }
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  try {
    const [subs, kicks] = await Promise.all([
      kv.get<number>(STREAM_GOALS_SUBS_KEY),
      kv.get<number>(STREAM_GOALS_KICKS_KEY),
    ]);
    return { subs: Math.max(0, subs ?? 0), kicks: Math.max(0, kicks ?? 0) };
  } catch {
    return { subs: 0, kicks: 0 };
  }
}

/** Manually set subs and/or kicks (admin override or chat commands). */
export async function setStreamGoals(updates: { subs?: number; kicks?: number }): Promise<void> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const patch: Record<string, unknown> = { goals_updated_at: new Date().toISOString() };
        if (updates.subs !== undefined) patch.goal_subs = Math.max(0, Math.floor(updates.subs));
        if (updates.kicks !== undefined) patch.goal_kicks = Math.max(0, Math.floor(updates.kicks));
        await supabase.from('creator_settings').update(patch).eq('creator_id', creatorId);
        void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
        return;
      }
    }
  } catch (e) {
    console.warn('[StreamGoals] Supabase set failed, falling back to KV:', e);
  }
  // KV fallback
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
}
