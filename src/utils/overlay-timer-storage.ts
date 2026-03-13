import { kv } from '@/lib/kv';
import type { OverlayTimerState } from '@/types/timer';

const OVERLAY_TIMER_STATE_KEY = 'overlay_timer_state';
const OVERLAY_SETTINGS_MODIFIED_KEY = 'overlay_settings_modified';

/** Grace period after timer expiry before we auto-clear it from KV (ms). */
const EXPIRED_GRACE_MS = 5 * 60_000;

/** Returns all active (non-expired) timers. Handles migration from single-timer format. */
export async function getOverlayTimers(): Promise<OverlayTimerState[]> {
  const raw = await kv.get<OverlayTimerState | OverlayTimerState[]>(OVERLAY_TIMER_STATE_KEY);
  if (!raw) return [];

  // Migrate: handle old single-timer format
  const timers: OverlayTimerState[] = Array.isArray(raw) ? raw : [raw];

  const now = Date.now();
  const active = timers.filter((t) => typeof t.endsAt === 'number' && t.endsAt >= now - EXPIRED_GRACE_MS);

  if (active.length !== timers.length) {
    try {
      if (active.length === 0) await kv.del(OVERLAY_TIMER_STATE_KEY);
      else await kv.set(OVERLAY_TIMER_STATE_KEY, active);
    } catch { /* non-critical */ }
  }

  return active;
}

/** Backward-compat: returns the first active timer or null. */
export async function getOverlayTimer(): Promise<OverlayTimerState | null> {
  const timers = await getOverlayTimers();
  return timers[0] ?? null;
}

const MAX_TIMERS = 3;

/** Add a new timer to the list. Returns false if the cap is already reached. */
export async function addTimer(state: OverlayTimerState): Promise<boolean> {
  const now = Date.now();
  const timers = await getOverlayTimers();
  if (timers.length >= MAX_TIMERS) return false;
  const normalized: OverlayTimerState = {
    createdAt: typeof state.createdAt === 'number' ? state.createdAt : now,
    endsAt: state.endsAt,
    title: state.title?.trim() || undefined,
  };
  timers.push(normalized);
  await Promise.allSettled([
    kv.set(OVERLAY_TIMER_STATE_KEY, timers),
    kv.set(OVERLAY_SETTINGS_MODIFIED_KEY, now),
  ]);
  return true;
}

/** Remove a specific timer by its createdAt timestamp. Returns true if removed. */
export async function removeTimerByCreatedAt(createdAt: number): Promise<boolean> {
  const now = Date.now();
  const timers = await getOverlayTimers();
  const filtered = timers.filter((t) => t.createdAt !== createdAt);
  if (filtered.length === timers.length) return false;
  await Promise.allSettled([
    filtered.length === 0 ? kv.del(OVERLAY_TIMER_STATE_KEY) : kv.set(OVERLAY_TIMER_STATE_KEY, filtered),
    kv.set(OVERLAY_SETTINGS_MODIFIED_KEY, now),
  ]);
  return true;
}

/** If state is null, clears all timers. Otherwise adds a single timer (backward compat). */
export async function setOverlayTimer(state: OverlayTimerState | null): Promise<void> {
  const now = Date.now();
  if (!state) {
    await Promise.allSettled([
      kv.del(OVERLAY_TIMER_STATE_KEY),
      kv.set(OVERLAY_SETTINGS_MODIFIED_KEY, now),
    ]);
    return;
  }
  await addTimer(state);
}
