export interface OverlayTimerState {
  /** When the timer should reach zero (ms since epoch). */
  endsAt: number;
  /** When the timer was created or last updated (ms since epoch). */
  createdAt: number;
  /** Optional label shown next to the countdown. */
  title?: string;
}

