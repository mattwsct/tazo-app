import { kv } from '@/lib/kv';
import type { ChallengeItem, ChallengesState, WalletState } from '@/types/challenges';

export const CHALLENGES_KEY = 'stream_challenges';
export const WALLET_KEY = 'stream_wallet';
export const CHALLENGES_MODIFIED_KEY = 'stream_challenges_modified';

const DEFAULT_WALLET_BALANCE = 15;

// ── Wallet ────────────────────────────────────────────────────────────────────

export async function getWallet(): Promise<WalletState> {
  const raw = await kv.get<WalletState>(WALLET_KEY);
  if (!raw || typeof raw.balance !== 'number') {
    return { balance: DEFAULT_WALLET_BALANCE, updatedAt: Date.now() };
  }
  return raw;
}

export async function setWalletBalance(balance: number): Promise<WalletState> {
  const state: WalletState = {
    balance: Math.round(Math.max(0, balance) * 100) / 100,
    updatedAt: Date.now(),
  };
  await Promise.all([
    kv.set(WALLET_KEY, state),
    kv.set(CHALLENGES_MODIFIED_KEY, Date.now()),
  ]);
  return state;
}

export async function addToWallet(amountUsd: number): Promise<WalletState> {
  const current = await getWallet();
  return setWalletBalance(current.balance + amountUsd);
}

export async function deductFromWallet(amountUsd: number): Promise<{ state: WalletState; deducted: number }> {
  const current = await getWallet();
  const deducted = Math.min(amountUsd, current.balance);
  const state = await setWalletBalance(current.balance - deducted);
  return { state, deducted };
}

export async function resetWallet(startingBalance?: number): Promise<WalletState> {
  return setWalletBalance(startingBalance ?? DEFAULT_WALLET_BALANCE);
}

// ── Challenges ────────────────────────────────────────────────────────────────

async function getChallengesState(): Promise<ChallengesState> {
  const raw = await kv.get<ChallengesState>(CHALLENGES_KEY);
  if (!raw || !Array.isArray(raw.challenges)) {
    return { challenges: [], nextId: 1 };
  }
  return raw;
}

async function saveChallengesState(state: ChallengesState): Promise<void> {
  await Promise.all([
    kv.set(CHALLENGES_KEY, state),
    kv.set(CHALLENGES_MODIFIED_KEY, Date.now()),
  ]);
}

/** Public alias for API route edits (status/desc/bounty). */
export async function setChallengesState(state: ChallengesState): Promise<void> {
  return saveChallengesState(state);
}

export async function getChallenges(): Promise<ChallengesState> {
  return getChallengesState();
}

export async function addChallenge(bounty: number, description: string): Promise<ChallengeItem> {
  const state = await getChallengesState();
  const item: ChallengeItem = {
    id: state.nextId,
    description,
    bounty: Math.round(Math.max(0, bounty) * 100) / 100,
    status: 'active',
    createdAt: Date.now(),
  };
  state.challenges.push(item);
  state.nextId += 1;
  await saveChallengesState(state);
  return item;
}

export async function updateChallengeStatus(
  id: number,
  status: 'completed' | 'failed'
): Promise<ChallengeItem | null> {
  const state = await getChallengesState();
  const challenge = state.challenges.find((c) => c.id === id);
  if (!challenge) return null;
  challenge.status = status;
  challenge.resolvedAt = Date.now();
  await saveChallengesState(state);
  return challenge;
}

export async function removeChallenge(id: number): Promise<boolean> {
  const state = await getChallengesState();
  const before = state.challenges.length;
  state.challenges = state.challenges.filter((c) => c.id !== id);
  if (state.challenges.length === before) return false;
  await saveChallengesState(state);
  return true;
}

export async function clearResolvedChallenges(): Promise<number> {
  const state = await getChallengesState();
  const before = state.challenges.length;
  state.challenges = state.challenges.filter((c) => c.status === 'active');
  const removed = before - state.challenges.length;
  if (removed > 0) await saveChallengesState(state);
  return removed;
}

export async function resetChallenges(): Promise<void> {
  await Promise.all([
    kv.del(CHALLENGES_KEY),
    kv.set(CHALLENGES_MODIFIED_KEY, Date.now()),
  ]);
}
