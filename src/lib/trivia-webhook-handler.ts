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
    if (existing) {
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
  if (!state) return { handled: false };

  const guess = normalizeGuess(trimmed);
  if (!guess) return { handled: false };

  const matched = state.acceptedAnswers.some(
    (a) => normalizeAnswerForMatch(a) === guess
  );
  if (!matched) return { handled: false };

  await setTriviaState(null);
  await addCredits(senderUsername, state.points, { skipExclusions: true });
  const token = await getValidAccessToken();
  const answerDisplay = state.acceptedAnswers[0] ?? '?';
  await replyChat(token, `${senderUsername} got it! Answer: ${answerDisplay}. +${state.points} Credits.`);
  return { handled: true };
}
