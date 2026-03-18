import { NextRequest, NextResponse } from 'next/server';
import { onStreamStarted } from '@/utils/stats-storage';
import { verifyRequestAuth } from '@/lib/api-auth';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { resetWallet, resetChallenges } from '@/utils/challenges-storage';
import { setOverlayTimer } from '@/utils/overlay-timer-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { POLL_STATE_KEY, POLL_QUEUE_KEY, LAST_POLL_ENDED_AT_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY } from '@/types/trivia';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const OVERLAY_ALERTS_KEY = 'kick_overlay_alerts';
const OVERLAY_TIMER_ANNOUNCED_KEY = 'overlay_timer_announced_ends_at';

/**
 * POST /api/reset-stream-session
 * Resets all per-stream state: wallet, challenges, goals, timer, poll, trivia, alerts.
 * Wellness data (steps/distance) resets naturally at midnight via Health Auto Export.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settings = await kv.get<Record<string, unknown>>('overlay_settings');
    const startingBalance = (settings?.walletStartingBalance as number) ?? 15;

    // Reset wallet to on-but-hidden so it accumulates from the first event but isn't visible until shown
    await kv.set('overlay_settings', { ...(settings ?? {}), walletEnabled: true, walletVisible: true });

    const [, { subTarget }] = await Promise.all([
      onStreamStarted(),
      resetStreamGoalsOnStreamStart(),
      resetWallet(startingBalance),
      resetChallenges(),
      // Clear active timer
      setOverlayTimer(null),
      // Clear poll (active state, queue, end-lock, auto-poll cooldown)
      kv.del(POLL_STATE_KEY),
      kv.del(POLL_QUEUE_KEY),
      kv.del(LAST_POLL_ENDED_AT_KEY),
      // Clear trivia
      kv.del(TRIVIA_STATE_KEY),
      // Clear overlay alerts (sub/gift/kicks banners)
      kv.del(OVERLAY_ALERTS_KEY),
      // Clear timer announcement dedup so first timer of new stream announces correctly
      kv.del(OVERLAY_TIMER_ANNOUNCED_KEY),
    ]);

    // Push fresh state to all overlay clients immediately
    void broadcastChallenges().catch(() => {});
    void updateKickTitleGoals(0, subTarget).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-stream-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
