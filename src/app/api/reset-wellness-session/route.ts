/**
 * POST /api/reset-wellness-session
 * Resets only wellness session: steps, distance, flights, active calories accumulated,
 * last-import dedup state, and wellness milestones.
 * Does not reset leaderboard or stream_started_at.
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getWellnessData,
  resetStepsSession,
  resetDistanceSession,
  resetFlightsSession,
  resetActiveCaloriesSession,
  resetWellnessLastImport,
  resetWellnessMilestonesOnStreamStart,
} from '@/utils/wellness-storage';
import { verifyRequestAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const wellness = await getWellnessData();
    await Promise.all([
      resetStepsSession(wellness?.steps ?? 0),
      resetDistanceSession(wellness?.distanceKm ?? 0),
      resetFlightsSession(wellness?.flightsClimbed ?? 0),
      resetActiveCaloriesSession(wellness?.activeCalories ?? 0),
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
