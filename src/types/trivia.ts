/**
 * Trivia (first-to-answer) types for overlay and Kick webhook.
 */

export interface TriviaState {
  id: string;
  question: string;
  /** Normalized (lowercase) for matching; can have multiple spellings */
  acceptedAnswers: string[];
  points: number;
  startedAt: number;
  /** Set when someone wins; overlay shows winner until winnerDisplayUntil */
  winnerUsername?: string;
  winnerAnswer?: string;
  winnerPoints?: number;
  winnerDisplayUntil?: number;
  /** Last time a reminder message was sent in chat (ms since epoch). */
  lastReminderAt?: number;
  /** How many reminder messages have been sent for this question. */
  reminderCount?: number;
}

export interface TriviaSettings {
  /** Default points when starting via !trivia (random from list) */
  defaultPoints: number;
  /** Raw text: one question and answer per line, format "Question ? Answer" */
  randomQuestionsText: string;
}

export const DEFAULT_TRIVIA_POINTS = 50;

export const TRIVIA_STATE_KEY = 'trivia_state';
export const TRIVIA_MODIFIED_KEY = 'trivia_modified';
export const TRIVIA_SETTINGS_KEY = 'trivia_settings';
