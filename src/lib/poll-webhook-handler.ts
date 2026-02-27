/**
 * Handles poll-related logic in the Kick webhook: !poll start, vote counting, poll end.
 */

import { kv } from '@vercel/kv';
import { KICK_BROADCASTER_SLUG_KEY, sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';
import { setLeaderboardDisplayName } from '@/utils/leaderboard-storage';
import { addTazosForReward, startAutoPoll } from '@/utils/gambling-storage';
import {
  parsePollCommand,
  parseRankCommand,
  parsePollDurationVariant,
  parseVote,
  canStartPoll,
  computePollResult,
  pollContainsBlockedContent,
  hasDuplicateOptions,
  pollExceedsLength,
  pollContainsInvalidChars,
  POLL_QUESTION_MAX_LENGTH,
  POLL_OPTION_MAX_LENGTH,
} from '@/lib/poll-logic';
import {
  getPollState,
  getPollStateAndSettings,
  setPollState,
  getPollQueue,
  setPollQueue,
  popPollQueue,
  tryAcquirePollEndLock,
} from '@/lib/poll-store';
import type { PollState, QueuedPoll } from '@/types/poll';


/** Parse badges array (strings or objects with type/slug/name) into role flags */
function parseBadges(badges: unknown): { isMod: boolean; isVip: boolean; isOg: boolean; isSub: boolean } {
  const out = { isMod: false, isVip: false, isOg: false, isSub: false };
  if (!badges || !Array.isArray(badges)) return out;
  for (const b of badges) {
    const v = typeof b === 'string' ? b.toLowerCase() : (b as Record<string, unknown>)?.type ?? (b as Record<string, unknown>)?.slug ?? (b as Record<string, unknown>)?.name ?? (b as Record<string, unknown>)?.text;
    const str = String(v ?? '').toLowerCase();
    if (str.includes('mod') || str === 'owner' || str === 'broadcaster') out.isMod = true;
    if (str === 'vip') out.isVip = true;
    if (str === 'og' || str === 'original') out.isOg = true;
    if (str.includes('sub') || str === 'subscriber') out.isSub = true;
  }
  return out;
}

/** Kick sender roles from payload. Checks identity.role, roles[], badges[], is_moderator/isModerator, etc. */
function getSenderRoles(sender: unknown): { isMod: boolean; isVip: boolean; isOg: boolean; isSub: boolean } {
  const out = { isMod: false, isVip: false, isOg: false, isSub: false };
  if (!sender || typeof sender !== 'object') return out;
  const s = sender as Record<string, unknown>;

  // Identity / role
  const identity = s.identity as Record<string, unknown> | undefined;
  const role = String(identity?.role ?? s.role ?? '').toLowerCase();
  const rolesArr = s.roles as string[] | undefined;
  const rolesLower = Array.isArray(rolesArr)
    ? rolesArr.map((r) => String(r).toLowerCase())
    : [];

  // Mod: role, roles array, boolean flags (snake_case and camelCase)
  if (role === 'moderator' || role === 'owner' || role === 'broadcaster' || rolesLower.includes('moderator') || rolesLower.includes('owner') || rolesLower.includes('broadcaster'))
    out.isMod = true;
  if (s.is_moderator === true || s.moderator === true || s.isModerator === true) out.isMod = true;

  // VIP, OG, Sub
  if (role === 'vip' || rolesLower.includes('vip') || s.is_vip === true || s.vip === true || s.isVip === true) out.isVip = true;
  if (role === 'og' || rolesLower.includes('og') || s.is_og === true || s.og === true || s.isOg === true) out.isOg = true;
  if (
    role === 'subscriber' ||
    role === 'sub' ||
    rolesLower.includes('subscriber') ||
    rolesLower.includes('sub') ||
    s.is_subscriber === true ||
    s.subscriber === true ||
    s.is_sub === true ||
    s.sub === true ||
    s.isSubscriber === true ||
    s.isSub === true
  )
    out.isSub = true;

  // Badges array (Kick may send roles as badges)
  const badges = s.badges ?? (identity?.badges as unknown);
  if (badges) {
    const fromBadges = parseBadges(badges);
    if (fromBadges.isMod) out.isMod = true;
    if (fromBadges.isVip) out.isVip = true;
    if (fromBadges.isOg) out.isOg = true;
    if (fromBadges.isSub) out.isSub = true;
  }

  return out;
}

/** Estimate seconds until a poll at queue position will start. */
function estimateSecondsUntilStart(
  positionInQueue: number,
  currentState: PollState | null,
  queue: QueuedPoll[],
  winnerDisplaySeconds: number,
  defaultDuration: number
): number {
  let seconds = 0;
  const now = Date.now() / 1000;

  if (currentState?.status === 'active') {
    const elapsed = now - currentState.startedAt / 1000;
    seconds += Math.max(0, currentState.durationSeconds - elapsed);
    seconds += winnerDisplaySeconds;
  } else if (currentState?.status === 'winner' && currentState.winnerDisplayUntil) {
    seconds += Math.max(0, (currentState.winnerDisplayUntil - Date.now()) / 1000);
  }

  for (let i = 0; i < positionInQueue - 1 && i < queue.length; i++) {
    seconds += (queue[i]?.durationSeconds ?? defaultDuration) + winnerDisplaySeconds;
  }
  return Math.round(seconds);
}

/** Format seconds as human-readable (e.g. "~2 min", "~45 sec") */
function formatSecondsEstimate(sec: number): string {
  if (sec < 60) return `~${sec} sec`;
  const min = Math.ceil(sec / 60);
  return `~${min} min`;
}

/** Build chat message for when a poll starts: question + how to vote. Exported for cron. */
export function buildPollStartMessage(question: string, options: { label: string }[], durationSeconds: number): string {
  const timeStr = durationSeconds >= 60
    ? `${Math.floor(durationSeconds / 60)}${durationSeconds % 60 !== 0 ? `:${String(durationSeconds % 60).padStart(2, '0')}` : ''} min`
    : `${durationSeconds} sec`;
  const labels = options.map((o) => `'${o.label.toLowerCase()}'`);
  const optionStr = labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels.join(', ');
  return `Poll started! ${question} Type ${optionStr} in chat to vote. (${timeStr})`;
}

/** Apply a vote to poll state. Mutates options. */
function applyVote(
  state: PollState,
  optionIndex: number,
  username: string,
  oneVotePerPerson: boolean
): void {
  const opt = state.options[optionIndex];
  if (!opt) return;
  if (!opt.voters) opt.voters = {};

  if (oneVotePerPerson) {
    // Find existing vote (if any)
    let prevOptIndex = -1;
    for (let i = 0; i < state.options.length; i++) {
      const count = state.options[i]?.voters?.[username] ?? 0;
      if (count > 0) {
        prevOptIndex = i;
        break;
      }
    }
    if (prevOptIndex >= 0 && prevOptIndex !== optionIndex) {
      // Move vote from old option to new
      const prevOpt = state.options[prevOptIndex];
      if (prevOpt?.voters) {
        prevOpt.votes -= prevOpt.voters[username] ?? 0;
        delete prevOpt.voters[username];
      }
    } else if (prevOptIndex === optionIndex) {
      // Already voted for this option; no-op
      return;
    }
  }

  opt.votes += 1;
  opt.voters[username] = (opt.voters[username] ?? 0) + 1;
}

export interface HandleChatPollResult {
  handled: boolean;
  /** If we should still run !ping (e.g. content was !ping but we didn't handle it) */
  continueToPing?: boolean;
}

/** Send a chat reply, swallowing errors. Returns the sent message (for extracting message ID). */
async function replyChat(
  token: string | null,
  msg: string,
  replyTo?: string
): Promise<{ message_id?: string; id?: string } | null> {
  if (!token) return null;
  try {
    return (await sendKickChatMessage(token, msg, replyTo ? { replyToMessageId: replyTo } : undefined)) as { message_id?: string; id?: string } | null;
  } catch { return null; }
}

/** Start a queued poll and announce it in chat. */
async function startQueuedPoll(queued: QueuedPoll, token: string | null): Promise<void> {
  const state: PollState = {
    id: `poll_${Date.now()}`,
    question: queued.question,
    options: queued.options.map((o) => ({ ...o, votes: 0, voters: {} })),
    startedAt: Date.now(),
    durationSeconds: queued.durationSeconds,
    status: 'active',
  };
  await setPollState(state);
  await replyChat(token, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
}

export async function handleChatPoll(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleChatPollResult> {
  const { state: initialState, settings } = await getPollStateAndSettings();
  if (!settings.enabled) return { handled: false };

  const contentTrimmed = content.trim();
  const contentLower = contentTrimmed.toLowerCase();
  const durationVariant = parsePollDurationVariant(contentTrimmed);
  const isPollCmd = contentLower.startsWith('!poll ') || (durationVariant !== null && durationVariant.rest.length > 0);
  const isBarePoll = contentLower === '!poll' || /^!poll\s*$/.test(contentLower) || (durationVariant !== null && durationVariant.rest.length === 0);
  const isEndPoll = contentLower === '!endpoll';
  const isRankCmd = contentLower.startsWith('!rank ');
  const isBareRank = contentLower === '!rank' || /^!rank\s*$/.test(contentLower);

  const needsChat = isEndPoll || isBarePoll || isPollCmd || isRankCmd || isBareRank ||
    (initialState?.status === 'winner') || (initialState?.status === 'active');
  const token = needsChat ? await getValidAccessToken() : null;
  const messageId = (payload.id ?? payload.message_id) as string | undefined;

  // --- !endpoll: mods and broadcaster only ---
  if (isEndPoll) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const isModOrBroadcaster = roles.isMod || senderUsername.toLowerCase() === (broadcasterSlug?.toLowerCase() ?? '');
    if (!isModOrBroadcaster) {
      await replyChat(token, 'Only mods and broadcaster can end polls.', messageId);
      return { handled: true };
    }
    if (!initialState || initialState.status !== 'active') {
      await replyChat(token, 'No poll active.', messageId);
      return { handled: true };
    }
    await setPollState(null);
    await replyChat(token, 'Poll ended early.', messageId);
    const queued = await popPollQueue();
    if (queued) await startQueuedPoll(queued, token);
    return { handled: true };
  }

  // --- Winner display expired: clear and start next queued poll ---
  if (
    !isPollCmd && !isRankCmd &&
    initialState?.status === 'winner' &&
    initialState.winnerDisplayUntil != null &&
    Date.now() >= initialState.winnerDisplayUntil
  ) {
    if (!(await tryAcquirePollEndLock())) return { handled: true };
    if (process.env.NODE_ENV === 'development') {
      console.log('[poll] webhook: winner display passed, popping queue');
    }
    await setPollState(null);
    const queued = await popPollQueue();
    if (queued) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: started queued poll', queued.question?.slice(0, 40));
      }
      await startQueuedPoll(queued, token);
    }
    return { handled: true };
  }

  // --- !poll with no args: start a random auto poll (broadcaster/mod only) ---
  if (isBarePoll) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const isModOrBroadcaster = roles.isMod || senderUsername.toLowerCase() === (broadcasterSlug?.toLowerCase() ?? '');
    if (!isModOrBroadcaster) {
      await replyChat(token, 'Usage: !poll Question? Option1, Option2 — or type !poll to start a random poll (mods only)', messageId);
      return { handled: true };
    }
    if (initialState?.status === 'active') {
      await replyChat(token, 'A poll is already active. Use !endpoll to end it first.', messageId);
      return { handled: true };
    }
    const announcement = await startAutoPoll(settings.durationSeconds);
    if (token) await sendKickChatMessage(token, announcement);
    return { handled: true };
  }

  // --- !rank with no args: show usage ---
  if (isBareRank) {
    await replyChat(token, 'Usage: !rank Option1, Option2, Option3 — viewers vote for their favorite', messageId);
    return { handled: true };
  }

  // --- !poll or !rank command: start or queue ---
  if (isPollCmd || isRankCmd) {
    const parsed = isRankCmd
      ? parseRankCommand(contentTrimmed)
      : parsePollCommand(durationVariant ? `!poll ${durationVariant.rest}` : contentTrimmed);
    if (!parsed) return { handled: true };

    const effectiveDuration = durationVariant?.duration ?? settings.durationSeconds;

    const validationError =
      (parsed.options.length > 5) ? 'Maximum 5 options allowed.' :
      (hasDuplicateOptions(parsed.options)) ? 'Duplicate options are not allowed (e.g. "yes, yes"). Use distinct options.' :
      pollExceedsLength(parsed.question, parsed.options) ? `Question max ${POLL_QUESTION_MAX_LENGTH} chars, each option max ${POLL_OPTION_MAX_LENGTH} chars.` :
      pollContainsInvalidChars(parsed.question, parsed.options) ? 'Question and options cannot contain control characters or invisible/special Unicode.' :
      pollContainsBlockedContent(parsed.question, parsed.options) ? 'Poll rejected: question or options contain inappropriate content.' :
      null;

    if (validationError) {
      if (validationError.startsWith('Poll rejected') && process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: rejected (content filter)', { question: parsed.question?.slice(0, 60) });
      }
      await replyChat(token, validationError, messageId);
      return { handled: true };
    }

    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const canStart = canStartPoll(senderUsername, broadcasterSlug, settings, roles);
    if (!canStart) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: rejected (no permission)', {
          sender: senderUsername,
          roles: { ...roles },
          settings: { modsCanStart: settings.modsCanStart, subsCanStart: settings.subsCanStart },
          rawSender: JSON.stringify(payload.sender).slice(0, 300),
        });
      }
      await replyChat(token, "You don't have permission to start polls.", messageId);
      return { handled: true };
    }

    const hasActive = initialState && initialState.status === 'active';
    const hasWinner = initialState && initialState.status === 'winner';

    if (hasActive || hasWinner) {
      const queue = await getPollQueue();

      if (hasWinner && queue.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[poll] webhook: winner+empty queue, starting immediately (skip queue msg)');
        }
        void setLeaderboardDisplayName(senderUsername.toLowerCase(), senderUsername);
        void addTazosForReward(senderUsername, 25);
        await setPollState(null);
        const state: PollState = {
          id: `poll_${Date.now()}`,
          question: parsed.question,
          options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
          startedAt: Date.now(),
          durationSeconds: effectiveDuration,
          status: 'active',
        };
        await setPollState(state);
        const sent = await replyChat(token, buildPollStartMessage(parsed.question, parsed.options, effectiveDuration), messageId);
        const msgId = sent?.message_id ?? sent?.id;
        if (msgId) {
          state.startMessageId = String(msgId);
          await setPollState(state);
        }
        return { handled: true };
      }

      const maxQueued = Math.max(1, settings.maxQueuedPolls ?? 5);
      if (queue.length >= maxQueued) {
        await replyChat(token, `Too many polls queued (max ${maxQueued}). Try again later.`, messageId);
        return { handled: true };
      }

      const newPoll: QueuedPoll = {
        question: parsed.question,
        options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
        durationSeconds: effectiveDuration,
      };
      const newQueue = [...queue, newPoll];
      void addTazosForReward(senderUsername, 25);
      await setPollQueue(newQueue);

      const position = newQueue.length;
      const estSec = estimateSecondsUntilStart(position, initialState, queue, settings.winnerDisplaySeconds, effectiveDuration);
      if (process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: queued poll', { position, question: parsed.question?.slice(0, 40), estSec, hasActive, hasWinner });
      }
      await replyChat(token, `Poll queued (#${position}). Estimated start: ${formatSecondsEstimate(estSec)}.`, messageId);
      return { handled: true };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[poll] webhook: starting new poll (no active/winner)', parsed.question?.slice(0, 40));
    }
    void setLeaderboardDisplayName(senderUsername.toLowerCase(), senderUsername);
    void addTazosForReward(senderUsername, 25);
    const state: PollState = {
      id: `poll_${Date.now()}`,
      question: parsed.question,
      options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
      startedAt: Date.now(),
      durationSeconds: effectiveDuration,
      status: 'active',
    };
    await setPollState(state);
    const sent = await replyChat(token, buildPollStartMessage(parsed.question, parsed.options, effectiveDuration), messageId);
    const msgId = sent?.message_id ?? sent?.id;
    if (msgId) {
      state.startMessageId = String(msgId);
      await setPollState(state);
    }
    return { handled: true };
  }

  // --- Vote or check poll end ---
  if (!initialState || initialState.status !== 'active') {
    return { handled: false };
  }

  const now = Date.now();
  const elapsed = (now - initialState.startedAt) / 1000;

  if (elapsed >= initialState.durationSeconds) {
    if (!(await tryAcquirePollEndLock())) return { handled: true };

    if (process.env.NODE_ENV === 'development') {
      console.log('[poll] webhook: ending poll (vote/msg triggered)', { elapsed, duration: initialState.durationSeconds });
    }
    const { winnerMessage, topVoter } = computePollResult(initialState);
    await replyChat(token, winnerMessage, initialState.startMessageId);
    const queued = await popPollQueue();
    if (queued) {
      await startQueuedPoll(queued, token);
      return { handled: true };
    }
    const currentNow = await getPollState();
    if (currentNow?.id !== initialState.id) {
      return { handled: true };
    }
    const winnerState: PollState = {
      ...initialState,
      status: 'winner',
      winnerMessage,
      winnerDisplayUntil: now + settings.winnerDisplaySeconds * 1000,
      topVoter,
    };
    await setPollState(winnerState);
    return { handled: true };
  }

  const vote = parseVote(contentTrimmed, initialState.options);
  if (vote) {
    // Reward 5 tazos on first vote in this poll (before mutating state)
    const isFirstVote = !initialState.options.some(o => (o.voters?.[senderUsername] ?? 0) > 0);
    applyVote(initialState, vote.optionIndex, senderUsername, settings.oneVotePerPerson ?? true);
    void setLeaderboardDisplayName(senderUsername.toLowerCase(), senderUsername);
    if (isFirstVote) void addTazosForReward(senderUsername, 5);
    const stateNow = await getPollState();
    if (stateNow?.id !== initialState.id) return { handled: true };
    await setPollState(initialState);
    return { handled: true };
  }

  return { handled: false };
}
