import { NextRequest, NextResponse } from 'next/server';
import { onStreamStarted } from '@/utils/stats-storage';
import {
  getWellnessData,
  resetStepsSession,
  resetDistanceSession,
  resetFlightsSession,
  resetActiveCaloriesSession,
  resetWellnessLastImport,
  resetWellnessMilestonesOnStreamStart,
} from '@/utils/wellness-storage';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { clearGoalCelebrationOnStreamStart } from '@/utils/stream-goals-celebration';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-stream-session
 * Manually resets stream session: leaderboard, steps, distance, flights, active calories,
 * wellness milestones, and stream_started_at. For use when auto-reset on stream start fails.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await onStreamStarted();

    const wellness = await getWellnessData();
    await Promise.all([
      resetStepsSession(wellness?.steps ?? 0),
      resetDistanceSession(wellness?.distanceKm ?? 0),
      resetFlightsSession(wellness?.flightsClimbed ?? 0),
      resetActiveCaloriesSession(wellness?.activeCalories ?? 0),
      resetWellnessLastImport(),
      resetWellnessMilestonesOnStreamStart(),
      resetStreamGoalsOnStreamStart(),
      clearGoalCelebrationOnStreamStart(),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-stream-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
