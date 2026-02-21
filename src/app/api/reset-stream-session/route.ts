import { NextRequest, NextResponse } from 'next/server';
import { onStreamStarted } from '@/utils/stats-storage';
import { resetLeaderboardOnStreamStart } from '@/utils/leaderboard-storage';
import {
  getWellnessData,
  resetStepsSession,
  resetDistanceSession,
  resetHandwashingSession,
  resetFlightsSession,
  resetWellnessMilestonesOnStreamStart,
} from '@/utils/wellness-storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-stream-session
 * Manually resets stream session: leaderboard, steps, distance, handwashing, flights,
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
    await resetLeaderboardOnStreamStart();

    const wellness = await getWellnessData();
    await Promise.all([
      resetStepsSession(wellness?.steps ?? 0),
      resetDistanceSession(wellness?.distanceKm ?? 0),
      resetHandwashingSession(wellness?.handwashingCount ?? 0),
      resetFlightsSession(wellness?.flightsClimbed ?? 0),
      resetWellnessMilestonesOnStreamStart(),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-stream-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
