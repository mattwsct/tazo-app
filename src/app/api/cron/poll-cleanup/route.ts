/**
 * Cron: Ends active polls when duration exceeded (no chat needed) and clears winner display.
 * Runs every minute. Overlay also calls poll-end-trigger when countdown ends for immediate chat update.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPollState, setPollState, popPollQueue, getPollQueue, tryAcquirePollEndLock } from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { endOverduePollIfAny } from '@/lib/poll-end-overdue';
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
  const now = Date.now();

  if (process.env.NODE_ENV === 'development') {
    const queue = await getPollQueue();
    console.log('[poll-cleanup]', {
      state: state ? { status: state.status, question: state.question?.slice(0, 30), startedAt: state.startedAt, durationSeconds: state.durationSeconds } : null,
      winnerDisplayUntil: state?.winnerDisplayUntil,
      queueLength: queue.length,
      now,
    });
  }

  if (await endOverduePollIfAny()) {
    return NextResponse.json({ ok: true, action: 'ended_active' });
  }

  const stateAfter = await getPollState();
  if (!stateAfter) {
    return NextResponse.json({ ok: true, action: 'none' });
  }

  if (
    !stateAfter ||
    stateAfter.status !== 'winner' ||
    stateAfter.winnerDisplayUntil == null ||
    now < stateAfter.winnerDisplayUntil
  ) {
    if (process.env.NODE_ENV === 'development' && stateAfter?.status === 'winner') {
      console.log('[poll-cleanup] action: none (winner display until', new Date(stateAfter.winnerDisplayUntil!).toISOString(), ')');
    }
    return NextResponse.json({ ok: true, action: 'none' });
  }

  if (!(await tryAcquirePollEndLock())) {
    return NextResponse.json({ ok: true, action: 'none' });
  }
  if (process.env.NODE_ENV === 'development') {
    console.log('[poll-cleanup] action: clearing winner, starting next from queue');
  }
  await setPollState(null);
  const queued = await popPollQueue();
  if (queued) {
    const newState: PollState = {
      id: `poll_${Date.now()}`,
      question: queued.question,
      options: queued.options.map((o) => ({ ...o, votes: 0, voters: {} })),
      startedAt: Date.now(),
      durationSeconds: queued.durationSeconds,
      status: 'active',
    };
    await setPollState(newState);
    const token = await getValidAccessToken();
    if (token) {
      try {
        await sendKickChatMessage(token, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
      } catch { /* ignore */ }
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[poll-cleanup] action: started_queued', queued.question?.slice(0, 40));
    }
    return NextResponse.json({ ok: true, action: 'started_queued' });
  }
  if (process.env.NODE_ENV === 'development') {
    console.log('[poll-cleanup] action: cleared (no queue)');
  }
  return NextResponse.json({ ok: true, action: 'cleared' });
}
