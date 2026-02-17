/**
 * Cron: Clears poll winner display and starts queued poll when winner time has passed.
 * Runs every minute.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPollState, setPollState, getPollQueue, setPollQueue } from '@/lib/poll-store';
import type { PollState } from '@/types/poll';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = await getPollState();
  if (
    !state ||
    state.status !== 'winner' ||
    state.winnerDisplayUntil == null ||
    Date.now() < state.winnerDisplayUntil
  ) {
    return NextResponse.json({ ok: true, action: 'none' });
  }

  await setPollState(null);
  const queued = await getPollQueue();
  if (queued) {
    await setPollQueue(null);
    const newState: PollState = {
      id: `poll_${Date.now()}`,
      question: queued.question,
      options: queued.options,
      startedAt: Date.now(),
      durationSeconds: queued.durationSeconds,
      status: 'active',
    };
    await setPollState(newState);
    return NextResponse.json({ ok: true, action: 'started_queued' });
  }
  return NextResponse.json({ ok: true, action: 'cleared' });
}
