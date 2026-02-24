import { NextRequest, NextResponse } from 'next/server';
import { resetEventTimestamps } from '@/utils/gambling-storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reset-event-timestamps
 * Clears raffle_last_at, chip_drop_last_at, chat_challenge_last_at, boss_last_at.
 * Use when auto events (drops, raffles, etc.) aren't starting — stale timestamps can block them.
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await resetEventTimestamps();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reset failed';
    console.warn('[reset-event-timestamps]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
