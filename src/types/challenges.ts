export interface ChallengeItem {
  id: number;
  description: string;
  bounty: number; // USD
  status: 'active' | 'completed' | 'failed' | 'timedOut';
  createdAt: number;
  resolvedAt?: number;
  /** If set, challenge auto-fails when Date.now() exceeds this. */
  expiresAt?: number;
  /** Username of the viewer who purchased this via !chatchallenge (for credit refund on removal). */
  buyerUsername?: string;
  /** If set, challenge auto-completes when step count reaches this value. */
  stepsTarget?: number;
  /** If set, challenge auto-completes when distance (km) reaches this value. */
  distanceTarget?: number;
}

export interface ChallengesState {
  challenges: ChallengeItem[];
  nextId: number;
}

export interface WalletState {
  balance: number; // USD, 2 decimal places
  updatedAt: number;
  /** Last change amount in USD (positive = added, negative = deducted). Used for overlay animation. */
  lastChangeUsd?: number;
  /** Exact original local-currency amount for the last change (e.g. -2.50 for a $2.50 AUD card spend).
   *  Stored when the original local amount is known (Wise webhook) to avoid USD round-trip imprecision. */
  lastChangeLocalAmount?: number;
  /** Source label for overlay animation, e.g. "SUB", "KICKS", "CHALLENGE". */
  lastChangeSource?: string;
  /** ISO 4217 local currency code (e.g. "JPY") when available from location. */
  localCurrency?: string;
  /** Exchange rate: 1 USD = localRate × localCurrency. Fetched when location is known. */
  localRate?: number;
  /** Total USD deducted from wallet since last reset. Used for overlay "spent" display. */
  totalSpent?: number;
}
