/**
 * Handles trivia in the Kick webhook: !trivia / !quiz (start random), !endtrivia / !endquiz, and guess matching.
 */

import { kv } from '@/lib/kv';
import { KICK_BROADCASTER_SLUG_KEY, sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';
import { getSenderRoles } from '@/lib/poll-webhook-handler';
import { addCredits } from '@/utils/gambling-storage';
import {
  getTriviaState,
  setTriviaState,
  pickRandomTrivia,
} from '@/lib/trivia-store';
import type { TriviaState } from '@/types/trivia';

export interface HandleTriviaResult {
  handled: boolean;
}

const TRIVIA_TIMEOUT_MS = 5 * 60 * 1000;         // auto-expire after 5 minutes
const TRIVIA_REMINDER_INTERVAL_MS = 2 * 60 * 1000; // remind every 2 minutes

/**
 * Check if the active trivia needs a reminder or has expired.
 * Safe to call frequently — exits immediately if no trivia is active.
 */
export async function tickTrivia(): Promise<void> {
  const state = await getTriviaState();
  if (!state || state.winnerDisplayUntil) return;

  const now = Date.now();

  // Auto-expire
  if (state.expiresAt && now >= state.expiresAt) {
    await setTriviaState(null);
    const token = await getValidAccessToken();
    if (token) {
      const answers = state.acceptedAnswers.slice(0, 3).join(' / ');
      await replyChat(token, `⏰ Trivia expired! The answer was: ${answers}`);
    }
    return;
  }

  // Reminder
  const lastBase = state.lastReminderAt ?? state.startedAt;
  if (now - lastBase >= TRIVIA_REMINDER_INTERVAL_MS) {
    await setTriviaState({ ...state, lastReminderAt: now, reminderCount: (state.reminderCount ?? 0) + 1 });
    const token = await getValidAccessToken();
    if (token) {
      await replyChat(token, `📢 Trivia: ${state.question} — First correct answer wins ${state.points} Credits.`);
    }
  }
}

/** Normalize a guess or stored answer for comparison: lowercase, trim, collapse whitespace, strip punctuation. */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function replyChat(token: string | null, msg: string): Promise<void> {
  if (!token) return;
  try {
    await sendKickChatMessage(token, msg);
  } catch {
    // ignore
  }
}

export async function handleTrivia(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleTriviaResult> {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  // --- Mod-only commands: !endtrivia / !endquiz / !trivia / !quiz ---
  const isTriviaCmd = lower === '!endtrivia' || lower === '!endquiz' || /^!(trivia|quiz)\s*$/.test(lower);
  if (isTriviaCmd) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const isMod = roles.isMod || senderUsername.toLowerCase() === (broadcasterSlug?.toLowerCase() ?? '');
    if (!isMod) return { handled: false };

    if (lower === '!endtrivia' || lower === '!endquiz') {
      const state = await getTriviaState();
      const token = await getValidAccessToken();
      if (!state) {
        await replyChat(token, 'No trivia active.');
      } else {
        await setTriviaState(null);
        await replyChat(token, 'Trivia cancelled.');
      }
      return { handled: true };
    }

    // !trivia / !quiz — start random
    const existing = await getTriviaState();
    // Only block if there's an active question; winner-display phase allows starting a new one
    if (existing && !existing.winnerDisplayUntil) {
      const token = await getValidAccessToken();
      await replyChat(token, 'A trivia is already active. Use !endtrivia or !endquiz to cancel.');
      return { handled: true };
    }
    const trivia = await pickRandomTrivia();
    const token = await getValidAccessToken();
    if (!trivia) {
      await replyChat(token, 'No random quiz questions configured. Add some in the admin under Trivia.');
      return { handled: true };
    }
    await setTriviaState({ ...trivia, expiresAt: Date.now() + TRIVIA_TIMEOUT_MS });
    await replyChat(token, `Trivia: ${trivia.question} — First correct answer wins ${trivia.points} Credits.`);
    return { handled: true };
  }

  // --- Guess check: any message when trivia is active ---
  // Tick first — this expires or reminds if due, before attempting to match the guess.
  await tickTrivia();

  // Retry getTriviaState once after a short delay if null, to handle race where the guess
  // webhook is processed before KV has the trivia state (e.g. right after !trivia).
  let state = await getTriviaState();
  if (!state && !trimmed.startsWith('!')) {
    await new Promise((r) => setTimeout(r, 150));
    state = await getTriviaState();
  }
  // Ignore guesses when we're only showing the winner (no new answers)
  if (!state || state.winnerDisplayUntil) return { handled: false };

  const guess = normalizeText(trimmed);
  if (!guess) return { handled: false };

  const matched = state.acceptedAnswers.some((a) => normalizeText(a) === guess);
  if (!matched) return { handled: false };

  // Only one winner: re-read state right before write so we don't award twice if multiple messages race
  const current = await getTriviaState();
  if (!current || current.winnerDisplayUntil) return { handled: false };

  const answerDisplay = trimmed.length > 100 ? trimmed.slice(0, 97) + '...' : trimmed;
  const winnerState: TriviaState = {
    ...current,
    winnerUsername: senderUsername,
    winnerAnswer: answerDisplay,
    winnerPoints: current.points,
    winnerDisplayUntil: Date.now() + 10_000,
  };
  await setTriviaState(winnerState);
  await addCredits(senderUsername, current.points, { skipExclusions: true });
  const token = await getValidAccessToken();
  await replyChat(token, `${senderUsername} got it! Answer: ${answerDisplay}. +${current.points} Credits.`);
  return { handled: true };
}
