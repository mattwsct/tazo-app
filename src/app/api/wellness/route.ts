/**
 * GET: Return today's wellness data (steps, distance, calories, body metrics) for overlay display.
 * Public — overlay needs it without auth.
 * Health Auto Export sends today's cumulative totals; data resets naturally at midnight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWellnessDataForDisplay } from '@/utils/wellness-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'wellness');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const data = await getWellnessDataForDisplay();
    return NextResponse.json(data || { updatedAt: 0 });
  } catch {
    return NextResponse.json({ error: 'Failed to load wellness data' }, { status: 500 });
  }
}
