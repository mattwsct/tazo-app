/**
 * GET: Return wellness data (steps, calories, distance, flights) for overlay display.
 * Public — overlay needs it without auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWellnessData, getStepsSinceStreamStart, getDistanceSinceStreamStart, getFlightsSinceStreamStart, getActiveCaloriesSinceStreamStart } from '@/utils/wellness-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'wellness');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const [data, stepsSinceStreamStart, distanceSinceStreamStart, flightsSinceStreamStart, activeCaloriesSinceStreamStart] = await Promise.all([
      getWellnessData(),
      getStepsSinceStreamStart(),
      getDistanceSinceStreamStart(),
      getFlightsSinceStreamStart(),
      getActiveCaloriesSinceStreamStart(),
    ]);
    return NextResponse.json({
      ...(data || { updatedAt: 0 }),
      stepsSinceStreamStart,
      distanceSinceStreamStart,
      flightsSinceStreamStart,
      activeCaloriesSinceStreamStart,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load wellness data' }, { status: 500 });
  }
}
