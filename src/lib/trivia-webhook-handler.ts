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

function normalizeGuess(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '') // strip punctuation/symbols
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAnswerForMatch(a: string): string {
  return a
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function replyChat(
  token: string | null,
  msg: string
): Promise<void> {
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

  // --- !endtrivia / !endquiz: mod/broadcaster only ---
  if (lower === '!endtrivia' || lower === '!endquiz') {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const isModOrBroadcaster = roles.isMod || senderUsername.toLowerCase() === (broadcasterSlug?.toLowerCase() ?? '');
    if (!isModOrBroadcaster) {
      return { handled: false };
    }
    const state = await getTriviaState();
    if (!state) {
      const token = await getValidAccessToken();
      await replyChat(token, 'No trivia active.');
      return { handled: true };
    }
    await setTriviaState(null);
    const token = await getValidAccessToken();
    await replyChat(token, 'Trivia cancelled.');
    return { handled: true };
  }

  // --- !trivia / !quiz: mod/broadcaster only, start random from list ---
  if (/^!(trivia|quiz)\s*$/.test(lower)) {
    const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    const roles = getSenderRoles(payload.sender);
    const isModOrBroadcaster = roles.isMod || senderUsername.toLowerCase() === (broadcasterSlug?.toLowerCase() ?? '');
    if (!isModOrBroadcaster) {
      return { handled: false };
    }
    const existing = await getTriviaState();
    // Only block if there's an active question; winner-display phase is not "active" — allow starting a new one
    if (existing && !existing.winnerDisplayUntil) {
      const token = await getValidAccessToken();
      await replyChat(token, 'A trivia is already active. Use !endtrivia or !endquiz to cancel.');
      return { handled: true };
    }
    const trivia = await pickRandomTrivia();
    if (!trivia) {
      const token = await getValidAccessToken();
      await replyChat(token, 'No random quiz questions configured. Add some in the admin under Trivia.');
      return { handled: true };
    }
    await setTriviaState(trivia);
    const token = await getValidAccessToken();
    await replyChat(token, `Trivia: ${trivia.question} — First correct answer wins ${trivia.points} Credits.`);
    return { handled: true };
  }

  // --- Guess check: any message when trivia is active ---
  // Retry getTriviaState once after a short delay if null, to handle race where the guess
  // webhook is processed before KV has the trivia state (e.g. right after !trivia).
  let state = await getTriviaState();
  if (!state && !trimmed.startsWith('!')) {
    await new Promise((r) => setTimeout(r, 150));
    state = await getTriviaState();
  }
  // Ignore guesses when we're only showing the winner (no new answers)
  if (!state || state.winnerDisplayUntil) return { handled: false };

  const guess = normalizeGuess(trimmed);
  if (!guess) return { handled: false };

  const matched = state.acceptedAnswers.some(
    (a) => normalizeAnswerForMatch(a) === guess
  );
  if (!matched) return { handled: false };

  // Only one winner: re-read state right before write so we don't award twice if multiple messages race
  const current = await getTriviaState();
  if (!current || current.winnerDisplayUntil) return { handled: false };

  const winnerDisplayMs = 8 * 1000;
  const winnerState: TriviaState = {
    ...current,
    winnerUsername: senderUsername,
    winnerAnswer: current.acceptedAnswers[0] ?? '?',
    winnerPoints: current.points,
    winnerDisplayUntil: Date.now() + winnerDisplayMs,
  };
  await setTriviaState(winnerState);
  await addCredits(senderUsername, current.points, { skipExclusions: true });
  const token = await getValidAccessToken();
  const answerDisplay = current.acceptedAnswers[0] ?? '?';
  await replyChat(token, `${senderUsername} got it! Answer: ${answerDisplay}. +${current.points} Credits.`);
  return { handled: true };
}
