import { kv } from '@/lib/kv';
import type { OverlayTimerState } from '@/types/timer';

const OVERLAY_TIMER_STATE_KEY = 'overlay_timer_state';
const OVERLAY_SETTINGS_MODIFIED_KEY = 'overlay_settings_modified';

/** Grace period after timer expiry before we auto-clear it from KV (ms). */
const EXPIRED_GRACE_MS = 5 * 60_000;

export async function getOverlayTimer(): Promise<OverlayTimerState | null> {
  const raw = await kv.get<OverlayTimerState | null>(OVERLAY_TIMER_STATE_KEY);
  if (!raw || typeof raw.endsAt !== 'number') return null;

  const now = Date.now();
  if (raw.endsAt < now - EXPIRED_GRACE_MS) {
    // Timer finished long ago — clean up KV so stale timers don't linger forever.
    try {
      await kv.del(OVERLAY_TIMER_STATE_KEY);
    } catch {
      // non-critical
    }
    return null;
  }

  return raw;
}

export async function setOverlayTimer(state: OverlayTimerState | null): Promise<void> {
  const now = Date.now();
  if (!state) {
    await Promise.allSettled([
      kv.del(OVERLAY_TIMER_STATE_KEY),
      kv.set(OVERLAY_SETTINGS_MODIFIED_KEY, now),
    ]);
    return;
  }

  const normalized: OverlayTimerState = {
    createdAt: typeof state.createdAt === 'number' ? state.createdAt : now,
    endsAt: state.endsAt,
    title: state.title?.trim() || undefined,
  };

  await Promise.allSettled([
    kv.set(OVERLAY_TIMER_STATE_KEY, normalized),
    kv.set(OVERLAY_SETTINGS_MODIFIED_KEY, now),
  ]);
}

