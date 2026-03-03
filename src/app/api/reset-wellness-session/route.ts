/**
 * POST /api/reset-wellness-session
 * Clears the wellness milestone tracking so daily cron chat messages restart from zero.
 * Does not clear actual wellness data (steps/distance/calories) — those come from Health Auto Export
 * and reset naturally at midnight.
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { setWellnessMilestoneLastSent } from '@/utils/wellness-storage';
import { verifyRequestAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await Promise.all([
      setWellnessMilestoneLastSent('steps', 0),
      setWellnessMilestoneLastSent('distanceKm', 0),
      setWellnessMilestoneLastSent('activeCalories', 0),
    ]);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-wellness-session]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
