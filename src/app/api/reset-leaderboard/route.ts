import { NextRequest, NextResponse } from 'next/server';
import { resetGamblingOnStreamStart } from '@/utils/gambling-storage';
import { verifyRequestAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-leaderboard
 * Resets chips leaderboard, gambling state, and display names.
 * Does not reset steps, distance, wellness, or stream_started_at.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await resetGamblingOnStreamStart();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-leaderboard]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
