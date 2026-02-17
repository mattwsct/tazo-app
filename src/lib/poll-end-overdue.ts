/**
 * Shared logic to end an overdue poll. Used by cron and poll-end-trigger (overlay).
 */

import { getPollState, setPollState, popPollQueue, getPollSettings } from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { computePollResult } from '@/lib/poll-logic';
import type { PollState } from '@/types/poll';

/**
 * If there's an active poll past its duration, end it (post winner to chat, set winner state or start next queued).
 * Returns true if an action was taken, false if nothing to do.
 */
export async function endOverduePollIfAny(): Promise<boolean> {
  const state = await getPollState();
  if (!state || state.status !== 'active') return false;

  const now = Date.now();
  const elapsed = (now - state.startedAt) / 1000;
  if (elapsed < state.durationSeconds) return false;

  const settings = await getPollSettings();
  const { winnerMessage, topVoter } = computePollResult(state);
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
    if (token) {
      try {
        await sendKickChatMessage(token, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
      } catch { /* ignore */ }
    }
    return true;
  }

  const winnerState: PollState = {
    ...state,
    status: 'winner',
    winnerMessage,
    winnerDisplayUntil: now + settings.winnerDisplaySeconds * 1000,
    topVoter,
  };
  await setPollState(winnerState);
  return true;
}
