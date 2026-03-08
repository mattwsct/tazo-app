import { NextRequest, NextResponse } from 'next/server';
import { clearBlackjackStateOnStreamStart } from '@/utils/gambling-storage';
import { verifyRequestAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-leaderboard
 * Clears only blackjack state (active hands + deal cooldown). Does not reset Credits balances.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await clearBlackjackStateOnStreamStart();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-leaderboard]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
