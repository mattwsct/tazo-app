/**
 * Trivia state and settings in KV. Broadcasts to overlay when state changes.
 */

import { kv } from '@/lib/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import {
  TRIVIA_STATE_KEY,
  TRIVIA_MODIFIED_KEY,
  TRIVIA_SETTINGS_KEY,
  DEFAULT_TRIVIA_POINTS,
  type TriviaState,
  type TriviaSettings,
} from '@/types/trivia';
import { POLL_STATE_KEY } from '@/types/poll';
import type { PollState } from '@/types/poll';

const DEFAULT_TRIVIA_SETTINGS: TriviaSettings = {
  defaultPoints: DEFAULT_TRIVIA_POINTS,
  randomQuestionsText: '',
};

export async function getTriviaState(): Promise<TriviaState | null> {
  return kv.get<TriviaState>(TRIVIA_STATE_KEY);
}

export async function setTriviaState(state: TriviaState | null): Promise<void> {
  await Promise.all([
    kv.set(TRIVIA_STATE_KEY, state),
    kv.set(TRIVIA_MODIFIED_KEY, Date.now()),
  ]);
  void broadcastTriviaAndSettings();
}

/** Broadcast overlay_settings + pollState + triviaState to SSE clients. */
export async function broadcastTriviaAndSettings(): Promise<void> {
  try {
    const [settings, rawPoll, rawTrivia] = await kv.mget<
      [Record<string, unknown> | null, PollState | null, TriviaState | null]
    >('overlay_settings', POLL_STATE_KEY, TRIVIA_STATE_KEY);
    const merged = mergeSettingsWithDefaults({
      ...(settings && typeof settings === 'object' ? settings : {}),
      pollState: rawPoll ?? null,
      triviaState: rawTrivia ?? null,
    });
    await broadcastSettings(merged);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[trivia-store] broadcast failed:', err);
    }
  }
}

export async function getTriviaSettings(): Promise<TriviaSettings> {
  const stored = await kv.get<Partial<TriviaSettings>>(TRIVIA_SETTINGS_KEY);
  return { ...DEFAULT_TRIVIA_SETTINGS, ...stored };
}

export async function setTriviaSettings(updates: Partial<TriviaSettings>): Promise<void> {
  const current = await getTriviaSettings();
  const merged = { ...current, ...updates };
  await kv.set(TRIVIA_SETTINGS_KEY, merged);
}

/**
 * Parse "Question ? Answer", "Question? Answer", "Question. Answer", or "Question\tAnswer" lines from randomQuestionsText.
 * Returns array of { question, answers } (answers normalized to lowercase).
 * Answer part can be comma- or semicolon-separated for multiple accepted answers (e.g. "chicken Parmigiana, chicken parmi, chicken parma").
 */
export function parseRandomQuestionsText(text: string): { question: string; answers: string[] }[] {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const out: { question: string; answers: string[] }[] = [];
  for (const line of lines) {
    let question: string;
    let answerPart: string;
    const tabIdx = line.indexOf('\t');
    const spaceQSpaceIdx = line.indexOf(' ? ');
    const anyQIdx = line.indexOf('?');
    const dotSepIdx = line.lastIndexOf('. ');
    if (tabIdx !== -1 && (spaceQSpaceIdx === -1 || tabIdx < spaceQSpaceIdx) && (anyQIdx === -1 || tabIdx < anyQIdx)) {
      question = line.slice(0, tabIdx).trim();
      answerPart = line.slice(tabIdx + 1).trim();
    } else if (spaceQSpaceIdx !== -1) {
      // Include the '?' in the stored question text
      question = line.slice(0, spaceQSpaceIdx + 2).trim();
      answerPart = line.slice(spaceQSpaceIdx + 3).trim();
    } else if (anyQIdx !== -1) {
      // Include the '?' in the stored question text
      question = line.slice(0, anyQIdx + 1).trim();
      answerPart = line.slice(anyQIdx + 1).trim();
    } else if (dotSepIdx !== -1) {
      // Allow questions that end with a full stop, e.g.
      // "Name one of Tazo's cats. Miggles, Sassy, Tazo"
      question = line.slice(0, dotSepIdx + 1).trim();
      answerPart = line.slice(dotSepIdx + 2).trim();
    } else {
      continue;
    }
    if (!question || !answerPart) continue;
    const answers = answerPart.split(/[,;]/).map((a) => a.trim().toLowerCase()).filter(Boolean);
    if (answers.length > 0) out.push({ question, answers });
  }
  return out;
}

/** Pick a random trivia from the saved list. Returns null if list is empty or invalid. */
export async function pickRandomTrivia(): Promise<TriviaState | null> {
  const settings = await getTriviaSettings();
  const list = parseRandomQuestionsText(settings.randomQuestionsText ?? '');
  if (list.length === 0) return null;
  const item = list[Math.floor(Math.random() * list.length)];
  const points = Math.max(1, Math.floor(settings.defaultPoints ?? DEFAULT_TRIVIA_POINTS));
  return {
    id: `trivia_${Date.now()}`,
    question: item.question,
    acceptedAnswers: item.answers,
    points,
    startedAt: Date.now(),
  };
}
