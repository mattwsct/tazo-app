/**
 * Chat-based poll types for overlay and Kick webhook.
 */

export interface PollOption {
  label: string;
  votes: number;
  /** Username -> vote count for top voter display */
  voters?: Record<string, number>;
}

export type PollStatus = 'active' | 'winner' | null;

export interface PollState {
  id: string;
  question: string;
  options: PollOption[];
  startedAt: number;
  durationSeconds: number;
  status: PollStatus;
  /** When to clear winner display (ms since epoch) */
  winnerDisplayUntil?: number;
  /** Parsed winner message for chat */
  winnerMessage?: string;
  /** Username who voted most, if notable */
  topVoter?: { username: string; count: number };
  /** Our poll-start message ID (for threading winner reply) */
  startMessageId?: string;
}

export interface QueuedPoll {
  question: string;
  options: PollOption[];
  durationSeconds: number;
}

export interface PollSettings {
  enabled: boolean;
  durationSeconds: number;
  everyoneCanStart: boolean;
  modsCanStart: boolean;
  vipsCanStart: boolean;
  ogsCanStart: boolean;
  subsCanStart: boolean;
  maxQueuedPolls: number;
  winnerDisplaySeconds: number;
  /** Auto-start location-based polls when stream is live and no poll run in X min */
  autoStartPollsEnabled?: boolean;
  /** Minutes since last poll ended before auto-starting (1–30). Recommended: 3–5. */
  minutesSinceLastPoll?: number;
  /** One vote per person (else unlimited votes per message) */
  oneVotePerPerson?: boolean;
}

export const DEFAULT_POLL_SETTINGS: PollSettings = {
  enabled: false,
  durationSeconds: 60,
  everyoneCanStart: false,
  modsCanStart: true,
  vipsCanStart: false,
  ogsCanStart: false,
  subsCanStart: false,
  maxQueuedPolls: 5,
  winnerDisplaySeconds: 10,
  autoStartPollsEnabled: false,
  minutesSinceLastPoll: 5,
  oneVotePerPerson: true,
};

export const POLL_STATE_KEY = 'overlay_poll_state';
export const POLL_MODIFIED_KEY = 'overlay_poll_modified';
export const POLL_QUEUE_KEY = 'overlay_poll_queue';
export const POLL_SETTINGS_KEY = 'kick_poll_settings';
export const LAST_POLL_ENDED_AT_KEY = 'overlay_last_poll_ended_at';
export const KICK_LAST_CHAT_MESSAGE_AT_KEY = 'kick_last_chat_message_at';
