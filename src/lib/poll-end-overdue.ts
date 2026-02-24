/**
 * Shared logic to end an overdue poll. Used by cron and poll-end-trigger (overlay).
 */

import {
  getPollState,
  setPollState,
  setLastPollEndedAt,
  popPollQueue,
  getPollSettings,
  tryAcquirePollEndLock,
} from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { computePollResult } from '@/lib/poll-logic';
import { isStreamLive } from '@/utils/stats-storage';
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

  if (!(await tryAcquirePollEndLock())) return false; // Another process is ending this poll

  const [settings, isLive, token] = await Promise.all([
    getPollSettings(),
    isStreamLive(),
    getValidAccessToken(),
  ]);
  const { winnerMessage, topVoter } = computePollResult(state);

  if (token && isLive) {
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
    await setLastPollEndedAt(); // Previous poll ended when replaced by queued
    const newState: PollState = {
      id: `poll_${Date.now()}`,
      question: queued.question,
      options: queued.options.map((o) => ({ ...o, votes: 0, voters: {} })),
      startedAt: Date.now(),
      durationSeconds: queued.durationSeconds,
      status: 'active',
    };
    await setPollState(newState);
    if (token && isLive) {
      try {
        await sendKickChatMessage(token, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
      } catch { /* ignore */ }
    }
    return true;
  }

  // Race guard: another process may have popped a queued poll and set it. Do not overwrite.
  const currentNow = await getPollState();
  if (currentNow?.id !== state.id) {
    return true; // State changed by concurrent process (e.g. new poll started); don't overwrite
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
