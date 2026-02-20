/**
 * Handles poll-related logic in the Kick webhook: !poll start, vote counting, poll end.
 */

import { kv } from '@vercel/kv';
import { KICK_BROADCASTER_SLUG_KEY, sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';
import {
  parsePollCommand,
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
import { buildRandomPoll } from '@/lib/poll-auto-start';
import {
  getPollState,
  getPollStateAndSettings,
  setPollState,
  getPollQueue,
  setPollQueue,
  popPollQueue,
  tryAcquirePollEndLock,
} from '@/lib/poll-store';
import type { PollState, PollOption, QueuedPoll } from '@/types/poll';


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
  const labels = options.map((o) => `'${o.label.toLowerCase()}'`);
  const optionStr = labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels.join(', ');
  const timeStr = durationSeconds === 60 ? '60 seconds' : durationSeconds === 30 ? '30 seconds' : `${durationSeconds} seconds`;
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
  const isPollStatus = contentLower === '!pollstatus' || contentLower === '!poll status';
  const isEndPoll = contentLower === '!endpoll';

  // --- !endpoll: mods and broadcaster only. End current poll and start next queued. ---
  if (isEndPoll) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const senderLower = senderUsername.toLowerCase();
    const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
    const isModOrBroadcaster = roles.isMod || senderLower === broadcasterLower;
    if (!isModOrBroadcaster) {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Only mods and broadcaster can end polls.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }
    const currentState = initialState;
    if (!currentState || currentState.status !== 'active') {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'No poll active.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }
    await setPollState(null);
    const accessToken = await getValidAccessToken();
    const messageId = (payload.id ?? payload.message_id) as string | undefined;
    if (accessToken) {
      try {
        await sendKickChatMessage(
          accessToken,
          'Poll ended by mod.',
          messageId ? { replyToMessageId: messageId } : undefined
        );
      } catch { /* ignore */ }
    }
    const queued = await popPollQueue();
    if (queued) {
      const state: PollState = {
        id: `poll_${Date.now()}`,
        question: queued.question,
        options: queued.options.map((o) => ({ ...o, votes: 0, voters: {} })),
        startedAt: Date.now(),
        durationSeconds: queued.durationSeconds,
        status: 'active',
      };
      await setPollState(state);
      if (accessToken) {
        try {
          await sendKickChatMessage(accessToken, buildPollStartMessage(queued.question, queued.options, queued.durationSeconds));
        } catch { /* ignore */ }
      }
    }
    return { handled: true };
  }

  // --- !pollstatus: show current poll or "no poll active" ---
  if (isPollStatus) {
    const state = initialState;
    const accessToken = await getValidAccessToken();
    if (!accessToken) return { handled: true };
    const messageId = (payload.id ?? payload.message_id) as string | undefined;
    if (state?.status === 'active') {
      const labels = state.options.map((o) => `'${o.label.toLowerCase()}'`);
      const optionStr = labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels.join(', ');
      const elapsed = (Date.now() - state.startedAt) / 1000;
      const remaining = Math.max(0, Math.ceil(state.durationSeconds - elapsed));
      const timeStr = remaining === 0 ? 'ending soon' : `${remaining}s left`;
      const msg = `Poll: ${state.question} Type ${optionStr} to vote. (${timeStr})`;
      try {
        await sendKickChatMessage(accessToken, msg, messageId ? { replyToMessageId: messageId } : undefined);
      } catch { /* ignore */ }
    } else {
      try {
        await sendKickChatMessage(accessToken, 'No poll active.', messageId ? { replyToMessageId: messageId } : undefined);
      } catch { /* ignore */ }
    }
    return { handled: true };
  }

  // --- If winner display time passed, clear and start next queued poll ---
  const currentStateBefore = initialState;
  if (
    !isPollCmd &&
    currentStateBefore?.status === 'winner' &&
    currentStateBefore.winnerDisplayUntil != null &&
    Date.now() >= currentStateBefore.winnerDisplayUntil
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
      const state: PollState = {
        id: `poll_${Date.now()}`,
        question: queued.question,
        options: queued.options.map((o) => ({ ...o, votes: 0, voters: {} })),
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

  // --- !poll with no args: start random location poll (mod/broadcaster only) ---
  if (isBarePoll) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const senderLower = senderUsername.toLowerCase();
    const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
    const isModOrBroadcaster = roles.isMod || senderLower === broadcasterLower;
    const effectiveDuration = durationVariant?.duration ?? settings.durationSeconds;
    if (isModOrBroadcaster) {
      const built = await buildRandomPoll();
      if (built) {
        const { question, options } = built;
        const currentState = initialState;
        const hasActive = currentState && currentState.status === 'active';
        const hasWinner = currentState && currentState.status === 'winner';
        const pollOptions = options.map((o) => ({ ...o, voters: {} }));
        if (!hasActive && !hasWinner) {
          const state: PollState = {
            id: `poll_${Date.now()}`,
            question,
            options: pollOptions,
            startedAt: Date.now(),
            durationSeconds: effectiveDuration,
            status: 'active',
          };
          await setPollState(state);
          const accessToken = await getValidAccessToken();
          const triggerMsgId = (payload.id ?? payload.message_id) as string | undefined;
          if (accessToken) {
            try {
              const sent = await sendKickChatMessage(
                accessToken,
                buildPollStartMessage(question, pollOptions, effectiveDuration),
                triggerMsgId ? { replyToMessageId: triggerMsgId } : undefined
              );
              const msgId = (sent as { message_id?: string; id?: string })?.message_id ?? (sent as { message_id?: string; id?: string })?.id;
              if (msgId) {
                state.startMessageId = String(msgId);
                await setPollState(state);
              }
            } catch { /* ignore */ }
          }
          return { handled: true };
        }
        const queue = await getPollQueue();
        const maxQueued = Math.max(1, settings.maxQueuedPolls ?? 5);
        if (queue.length < maxQueued) {
          const queuedPoll = { question, options: pollOptions, durationSeconds: effectiveDuration };
          await setPollQueue([...queue, queuedPoll]);
          const accessToken = await getValidAccessToken();
          const messageId = (payload.id ?? payload.message_id) as string | undefined;
          if (accessToken) {
            try {
              await sendKickChatMessage(
                accessToken,
                `Poll queued (#${queue.length + 1}). Estimated start: after current poll.`,
                messageId ? { replyToMessageId: messageId } : undefined
              );
            } catch { /* ignore */ }
          }
          return { handled: true };
        }
        const accessToken = await getValidAccessToken();
        const messageId = (payload.id ?? payload.message_id) as string | undefined;
        if (accessToken) {
          try {
            await sendKickChatMessage(
              accessToken,
              `Too many polls queued (max ${maxQueued}). Try again later.`,
              messageId ? { replyToMessageId: messageId } : undefined
            );
          } catch { /* ignore */ }
        }
        return { handled: true };
      }
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Could not build a random poll — try again.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }
  }

  // --- !poll command: start or queue ---
  if (isPollCmd) {
    const inputToParse = durationVariant ? `!poll ${durationVariant.rest}` : contentTrimmed;
    const parsed = parsePollCommand(inputToParse);
    if (!parsed) return { handled: true };

    const effectiveDuration = durationVariant?.duration ?? settings.durationSeconds;

    if (parsed.options.length > 5) {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Maximum 5 options allowed.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    if (hasDuplicateOptions(parsed.options)) {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Duplicate options are not allowed (e.g. "yes, yes"). Use distinct options.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    if (pollExceedsLength(parsed.question, parsed.options)) {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            `Question max ${POLL_QUESTION_MAX_LENGTH} chars, each option max ${POLL_OPTION_MAX_LENGTH} chars.`,
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    if (pollContainsInvalidChars(parsed.question, parsed.options)) {
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Question and options cannot contain control characters or invisible/special Unicode.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    if (pollContainsBlockedContent(parsed.question, parsed.options)) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: rejected (content filter)', { question: parsed.question?.slice(0, 60) });
      }
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            'Poll rejected: question or options contain inappropriate content.',
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
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
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            "You don't have permission to start polls.",
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    const currentState = initialState;
    const hasActive = currentState && currentState.status === 'active';
    const hasWinner = currentState && currentState.status === 'winner';

    if (hasActive || hasWinner) {
      const queue = await getPollQueue();

      if (hasWinner && queue.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[poll] webhook: winner+empty queue, starting immediately (skip queue msg)');
        }
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
        const accessToken = await getValidAccessToken();
        const triggerMsgId = (payload.id ?? payload.message_id) as string | undefined;
        if (accessToken) {
          try {
            const sent = await sendKickChatMessage(
              accessToken,
              buildPollStartMessage(parsed.question, parsed.options, effectiveDuration),
              triggerMsgId ? { replyToMessageId: triggerMsgId } : undefined
            );
            const msgId = (sent as { message_id?: string; id?: string })?.message_id ?? (sent as { message_id?: string; id?: string })?.id;
            if (msgId) {
              state.startMessageId = String(msgId);
              await setPollState(state);
            }
          } catch { /* ignore */ }
        }
        return { handled: true };
      }

      const maxQueued = Math.max(1, settings.maxQueuedPolls ?? 5);

      if (queue.length >= maxQueued) {
        const accessToken = await getValidAccessToken();
        const messageId = (payload.id ?? payload.message_id) as string | undefined;
        if (accessToken) {
          try {
            await sendKickChatMessage(
              accessToken,
              `Too many polls queued (max ${maxQueued}). Try again later.`,
              messageId ? { replyToMessageId: messageId } : undefined
            );
          } catch { /* ignore */ }
        }
        return { handled: true };
      }

      const newPoll: QueuedPoll = {
        question: parsed.question,
        options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
        durationSeconds: effectiveDuration,
      };
      const newQueue = [...queue, newPoll];
      await setPollQueue(newQueue);

      const position = newQueue.length;
      const estSec = estimateSecondsUntilStart(
        position,
        currentState,
        queue,
        settings.winnerDisplaySeconds,
        effectiveDuration
      );
      if (process.env.NODE_ENV === 'development') {
        console.log('[poll] webhook: queued poll', {
          position,
          question: parsed.question?.slice(0, 40),
          estSec,
          hasActive,
          hasWinner,
        });
      }
      const accessToken = await getValidAccessToken();
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            `Poll queued (#${position}). Estimated start: ${formatSecondsEstimate(estSec)}.`,
            messageId ? { replyToMessageId: messageId } : undefined
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[poll] webhook: starting new poll (no active/winner)', parsed.question?.slice(0, 40));
    }
    // Start new poll
    const triggerMsgId = (payload.id ?? payload.message_id) as string | undefined;
    const state: PollState = {
      id: `poll_${Date.now()}`,
      question: parsed.question,
      options: parsed.options.map((o) => ({ ...o, votes: 0, voters: {} })),
      startedAt: Date.now(),
      durationSeconds: effectiveDuration,
      status: 'active',
    };
    await setPollState(state);
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      try {
        const sent = await sendKickChatMessage(
          accessToken,
          buildPollStartMessage(parsed.question, parsed.options, effectiveDuration),
          triggerMsgId ? { replyToMessageId: triggerMsgId } : undefined
        );
        const msgId = (sent as { message_id?: string; id?: string })?.message_id ?? (sent as { message_id?: string; id?: string })?.id;
        if (msgId) {
          state.startMessageId = String(msgId);
          await setPollState(state);
        }
      } catch { /* ignore */ }
    }
    return { handled: true };
  }

  // --- Vote or check poll end ---
  const currentState = initialState;
  if (!currentState || currentState.status !== 'active') {
    return { handled: false };
  }

  const now = Date.now();
  const elapsed = (now - currentState.startedAt) / 1000;

  if (elapsed >= currentState.durationSeconds) {
    if (!(await tryAcquirePollEndLock())) return { handled: true }; // Another process is ending this poll

    if (process.env.NODE_ENV === 'development') {
      console.log('[poll] webhook: ending poll (vote/msg triggered)', { elapsed, duration: currentState.durationSeconds });
    }
    const { winnerMessage, topVoter } = computePollResult(currentState);
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      try {
        await sendKickChatMessage(
          accessToken,
          winnerMessage,
          currentState.startMessageId ? { replyToMessageId: currentState.startMessageId } : undefined
        );
      } catch { /* ignore */ }
    }
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
      if (accessToken) {
        try {
          await sendKickChatMessage(
            accessToken,
            buildPollStartMessage(queued.question, queued.options, queued.durationSeconds)
          );
        } catch { /* ignore */ }
      }
      return { handled: true };
    }
    // Race guard: another process (cron, poll-end-trigger) may have popped and started next poll
    const currentNow = await getPollState();
    if (currentNow?.id !== currentState.id) {
      return { handled: true };
    }
    const winnerState: PollState = {
      ...currentState,
      status: 'winner',
      winnerMessage,
      winnerDisplayUntil: now + settings.winnerDisplaySeconds * 1000,
      topVoter,
    };
    await setPollState(winnerState);
    return { handled: true };
  }

  // Try to parse as vote
  const vote = parseVote(contentTrimmed, currentState.options, senderUsername);
  if (vote) {
    applyVote(currentState, vote.optionIndex, senderUsername, settings.oneVotePerPerson ?? false);
    // Guard: poll may have ended and been replaced; don't overwrite new poll with stale voted state
    const stateNow = await getPollState();
    if (stateNow?.id !== currentState.id) return { handled: true };
    await setPollState(currentState);
    return { handled: true };
  }

  return { handled: false };
}
