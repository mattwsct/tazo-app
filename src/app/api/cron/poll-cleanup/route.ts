/**
 * Cron: Ends active polls when duration exceeded (no chat needed) and clears winner display.
 * Runs every minute.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPollState, setPollState, popPollQueue } from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { computePollResult } from '@/lib/poll-logic';
import { getPollSettings } from '@/lib/poll-store';
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

  if (state?.status === 'active') {
    const elapsed = (now - state.startedAt) / 1000;
    if (elapsed >= state.durationSeconds) {
      const settings = await getPollSettings();
      const { winnerMessage } = computePollResult(state);
      const winnerState: PollState = {
        ...state,
        status: 'winner',
        winnerMessage,
        winnerDisplayUntil: now + settings.winnerDisplaySeconds * 1000,
        topVoter: computePollResult(state).topVoter,
      };
      await setPollState(winnerState);
      const token = await getValidAccessToken();
      if (token) {
        try {
          await sendKickChatMessage(
            token,
            winnerMessage,
            state.startMessageId ? { replyToMessageId: state.startMessageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return NextResponse.json({ ok: true, action: 'ended_active' });
    }
  }

  if (
    !state ||
    state.status !== 'winner' ||
    state.winnerDisplayUntil == null ||
    now < state.winnerDisplayUntil
  ) {
    return NextResponse.json({ ok: true, action: 'none' });
  }

  await setPollState(null);
  const queued = await popPollQueue();
  if (queued) {
    const newState: PollState = {
      id: `poll_${Date.now()}`,
      question: queued.question,
      options: queued.options,
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
    return NextResponse.json({ ok: true, action: 'started_queued' });
  }
  return NextResponse.json({ ok: true, action: 'cleared' });
}
