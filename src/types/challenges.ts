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
  /** Source label for overlay animation, e.g. "SUB", "KICKS", "CHALLENGE". */
  lastChangeSource?: string;
  /** ISO 4217 local currency code (e.g. "JPY") when available from location. */
  localCurrency?: string;
  /** Exchange rate: 1 USD = localRate × localCurrency. Fetched when location is known. */
  localRate?: number;
}
