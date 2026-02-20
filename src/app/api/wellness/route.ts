/**
 * GET: Return wellness data (steps, calories, sleep, etc.) for overlay display.
 * Public — overlay needs it without auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWellnessData, getStepsSinceStreamStart } from '@/utils/wellness-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'wellness');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const [data, stepsSinceStreamStart] = await Promise.all([
      getWellnessData(),
      getStepsSinceStreamStart(),
    ]);
    return NextResponse.json({
      ...(data || { updatedAt: 0 }),
      stepsSinceStreamStart,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load wellness data' }, { status: 500 });
  }
}
