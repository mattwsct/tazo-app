export interface ChallengeItem {
  id: number;
  description: string;
  bounty: number; // USD
  status: 'active' | 'completed' | 'failed';
  createdAt: number;
  resolvedAt?: number;
}

export interface ChallengesState {
  challenges: ChallengeItem[];
  nextId: number;
}

export interface WalletState {
  balance: number; // USD, 2 decimal places
  updatedAt: number;
}
