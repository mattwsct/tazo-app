/**
 * POST /api/reset-wellness-session
 * Resets only wellness session: steps, distance, handwashing, flights accumulated,
 * last-import dedup state, and wellness milestones.
 * Does not reset leaderboard or stream_started_at.
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getWellnessData,
  resetStepsSession,
  resetDistanceSession,
  resetHandwashingSession,
  resetFlightsSession,
  resetWellnessLastImport,
  resetWellnessMilestonesOnStreamStart,
} from '@/utils/wellness-storage';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const wellness = await getWellnessData();
    await Promise.all([
      resetStepsSession(wellness?.steps ?? 0),
      resetDistanceSession(wellness?.distanceKm ?? 0),
      resetHandwashingSession(wellness?.handwashingCount ?? 0),
      resetFlightsSession(wellness?.flightsClimbed ?? 0),
      resetWellnessLastImport(),
      resetWellnessMilestonesOnStreamStart(),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-wellness-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
