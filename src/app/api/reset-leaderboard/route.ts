import { NextRequest, NextResponse } from 'next/server';
import { resetLeaderboardOnStreamStart } from '@/utils/leaderboard-storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-leaderboard
 * Resets only the leaderboard (points, display names, first chatter).
 * Does not reset steps, distance, wellness, or stream_started_at.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await resetLeaderboardOnStreamStart();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-leaderboard]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
