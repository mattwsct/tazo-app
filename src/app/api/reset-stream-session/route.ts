import { NextRequest, NextResponse } from 'next/server';
import { onStreamStarted } from '@/utils/stats-storage';
import { verifyRequestAuth } from '@/lib/api-auth';
import {
  getWellnessData,
  resetStepsSession,
  resetDistanceSession,
  resetFlightsSession,
  resetActiveCaloriesSession,
  resetWellnessLastImport,
  resetWellnessMilestonesOnStreamStart,
  setWellnessSessionStart,
} from '@/utils/wellness-storage';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { clearGoalCelebrationOnStreamStart } from '@/utils/stream-goals-celebration';
import { updateKickTitleSubCount } from '@/lib/stream-title-updater';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-stream-session
 * Manually resets stream session: leaderboard, steps, distance, flights, active calories,
 * wellness milestones, and stream_started_at. For use when auto-reset on stream start fails.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await onStreamStarted();

    const wellness = await getWellnessData();
    const sessionStartAt = Date.now();
    const [, , , , , , { subTarget }] = await Promise.all([
      resetStepsSession(wellness?.steps ?? 0),
      resetDistanceSession(wellness?.distanceKm ?? 0),
      resetFlightsSession(wellness?.flightsClimbed ?? 0),
      resetActiveCaloriesSession(wellness?.activeCalories ?? 0),
      resetWellnessLastImport(),
      resetWellnessMilestonesOnStreamStart(),
      resetStreamGoalsOnStreamStart(),
      clearGoalCelebrationOnStreamStart(),
      setWellnessSessionStart(sessionStartAt),
    ]);

    // Update the stream title to reflect the reset (0 subs, new initial target)
    void updateKickTitleSubCount(0, subTarget).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-stream-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
