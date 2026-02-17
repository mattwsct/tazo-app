/**
 * Handles poll-related logic in the Kick webhook: !poll start, vote counting, poll end.
 */

import { kv } from '@vercel/kv';
import { sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';
import { parsePollCommand, parseVote, canStartPoll, computePollResult } from '@/lib/poll-logic';
import {
  getPollState,
  setPollState,
  getPollQueue,
  setPollQueue,
  getPollSettings,
} from '@/lib/poll-store';
import type { PollState, PollOption, QueuedPoll } from '@/types/poll';

const KICK_BROADCASTER_SLUG_KEY = 'kick_broadcaster_slug';

/** Kick sender roles from payload. Check common paths: identity.role, roles[], is_moderator, is_vip, is_og, etc. */
function getSenderRoles(sender: unknown): { isMod: boolean; isVip: boolean; isOg: boolean } {
  const out = { isMod: false, isVip: false, isOg: false };
  if (!sender || typeof sender !== 'object') return out;
  const s = sender as Record<string, unknown>;
  const identity = s.identity as Record<string, unknown> | undefined;
  const role = identity?.role ?? s.role;
  const rolesArr = s.roles as string[] | undefined;
  const rolesLower = Array.isArray(rolesArr)
    ? rolesArr.map((r) => String(r).toLowerCase())
    : [];

  if (role === 'moderator' || role === 'owner' || rolesLower.includes('moderator') || rolesLower.includes('owner'))
    out.isMod = true;
  if (s.is_moderator === true || s.moderator === true) out.isMod = true;
  if (role === 'vip' || rolesLower.includes('vip') || s.is_vip === true || s.vip === true) out.isVip = true;
  if (role === 'og' || rolesLower.includes('og') || s.is_og === true || s.og === true) out.isOg = true;

  return out;
}

/** Build chat message for when a poll starts: question + how to vote */
function buildPollStartMessage(question: string, options: { label: string }[], durationSeconds: number): string {
  const labels = options.map((o) => `'${o.label.toLowerCase()}'`);
  const optionStr = labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels.join(', ');
  const timeStr = durationSeconds === 60 ? '60 seconds' : `${durationSeconds} seconds`;
  return `Poll started! ${question} Type ${optionStr} in chat to vote. (${timeStr})`;
}

/** Apply a vote to poll state. Mutates options. */
function applyVote(state: PollState, optionIndex: number, username: string): void {
  const opt = state.options[optionIndex];
  if (!opt) return;
  opt.votes += 1;
  if (!opt.voters) opt.voters = {};
  opt.voters[username] = (opt.voters[username] ?? 0) + 1;
}

export interface HandleChatPollResult {
  handled: boolean;
  /** If we should still run !ping (e.g. content was !ping but we didn't handle it) */
  continueToPing?: boolean;
}

export async function handleChatPoll(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleChatPollResult> {
  const settings = await getPollSettings();
  if (!settings.enabled) return { handled: false };

  const contentTrimmed = content.trim();
  const isPollCmd = contentTrimmed.toLowerCase().startsWith('!poll ');

  // --- If winner display time passed, clear and start queued poll ---
  const currentStateBefore = await getPollState();
  if (
    !isPollCmd &&
    currentStateBefore?.status === 'winner' &&
    currentStateBefore.winnerDisplayUntil != null &&
    Date.now() >= currentStateBefore.winnerDisplayUntil
  ) {
    await setPollState(null);
    const queued = await getPollQueue();
    if (queued) {
      await setPollQueue(null);
      const state: PollState = {
        id: `poll_${Date.now()}`,
        question: queued.question,
        options: queued.options,
        startedAt: Date.now(),
        durationSeconds: queued.durationSeconds,
        status: 'active',
      };
      await setPollState(state);
      const accessToken = await getValidAccessToken();
      if (accessToken) {
        try {
          await sendKickChatMessage(accessToken, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
        } catch { /* ignore */ }
      }
    }
    return { handled: true };
  }

  // --- !poll command: start or queue ---
  if (isPollCmd) {
    const parsed = parsePollCommand(contentTrimmed);
    if (!parsed) return { handled: true };

    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const canStart = canStartPoll(senderUsername, broadcasterSlug, settings, roles);
    if (!canStart) return { handled: true };

    const currentState = await getPollState();
    const hasActive = currentState && currentState.status === 'active';
    const hasWinner = currentState && currentState.status === 'winner';

    if (hasActive || hasWinner) {
      await setPollQueue({
        question: parsed.question,
        options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
        durationSeconds: settings.durationSeconds,
      });
      const accessToken = await getValidAccessToken();
      if (accessToken) {
        try {
          await sendKickChatMessage(accessToken, 'Poll queued. Will start after the current poll ends.');
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    // Start new poll
    const state: PollState = {
      id: `poll_${Date.now()}`,
      question: parsed.question,
      options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
      startedAt: Date.now(),
      durationSeconds: settings.durationSeconds,
      status: 'active',
    };
    await setPollState(state);
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      try {
        await sendKickChatMessage(accessToken, buildPollStartMessage(parsed.question, parsed.options, settings.durationSeconds));
      } catch { /* ignore */ }
    }
    return { handled: true };
  }

  // --- Vote or check poll end ---
  const currentState = await getPollState();
  if (!currentState || currentState.status !== 'active') {
    return { handled: false };
  }

  const now = Date.now();
  const elapsed = (now - currentState.startedAt) / 1000;
  if (elapsed >= currentState.durationSeconds) {
    // Poll ended - compute winner, post to chat, set winner state
    const { winnerMessage } = computePollResult(currentState);
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      try {
        await sendKickChatMessage(accessToken, winnerMessage);
      } catch { /* ignore */ }
    }
    const winnerState: PollState = {
      ...currentState,
      status: 'winner',
      winnerMessage,
      winnerDisplayUntil: now + settings.winnerDisplaySeconds * 1000,
      topVoter: computePollResult(currentState).topVoter,
    };
    await setPollState(winnerState);
    return { handled: true };
  }

  // Try to parse as vote
  const vote = parseVote(contentTrimmed, currentState.options, senderUsername);
  if (vote) {
    applyVote(currentState, vote.optionIndex, senderUsername);
    await setPollState(currentState);
    return { handled: true };
  }

  return { handled: false };
}
