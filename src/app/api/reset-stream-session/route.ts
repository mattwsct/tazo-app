import { NextRequest, NextResponse } from 'next/server';
import { onStreamStarted, setStreamLive } from '@/utils/stats-storage';
import { verifyRequestAuth } from '@/lib/api-auth';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-stream-session
 * Manually resets stream session: leaderboard and stream goals.
 * Wellness data (steps/distance/calories) resets naturally at midnight via Health Auto Export.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [, { subTarget }] = await Promise.all([
      onStreamStarted(),
      resetStreamGoalsOnStreamStart(),
      setStreamLive(true),
    ]);

    void updateKickTitleGoals(0, subTarget).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-stream-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
