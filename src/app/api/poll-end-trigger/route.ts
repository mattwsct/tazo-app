/**
 * Lightweight endpoint for overlay to trigger poll end when countdown reaches 0.
 * Ends overdue polls immediately so the winner posts to chat without waiting for cron (1 min) or next chat message.
 * Safe: only acts when elapsed >= duration (no early termination).
 */

import { NextResponse } from 'next/server';
import { endOverduePollIfAny } from '@/lib/poll-end-overdue';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const acted = await endOverduePollIfAny();
    return NextResponse.json({ ok: true, acted });
  } catch (err) {
    console.error('[poll-end-trigger]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
