import { kv } from '@/lib/kv';
import type { ChallengeItem, ChallengesState, WalletState } from '@/types/challenges';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';

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

export async function setWalletBalance(
  balance: number,
  opts?: { lastChangeUsd?: number; lastChangeSource?: string; localCurrency?: string; localRate?: number }
): Promise<WalletState> {
  const current = await getWallet();
  const state: WalletState = {
    balance: Math.round(Math.max(0, balance) * 100) / 100,
    updatedAt: Date.now(),
    ...(opts?.lastChangeUsd !== undefined ? { lastChangeUsd: opts.lastChangeUsd } : {}),
    ...(opts?.lastChangeSource ? { lastChangeSource: opts.lastChangeSource } : {}),
    // Carry forward local currency info unless explicitly replaced
    localCurrency: opts?.localCurrency ?? current.localCurrency,
    localRate: opts?.localRate ?? current.localRate,
  };
  await Promise.all([
    kv.set(WALLET_KEY, state),
    kv.set(CHALLENGES_MODIFIED_KEY, Date.now()),
  ]);
  return state;
}

export async function addToWallet(
  amountUsd: number,
  opts?: { source?: string }
): Promise<WalletState> {
  const current = await getWallet();
  return setWalletBalance(current.balance + amountUsd, {
    lastChangeUsd: amountUsd,
    ...(opts?.source ? { lastChangeSource: opts.source } : {}),
  });
}

export async function deductFromWallet(
  amountUsd: number,
  localContext?: { currency: string; rate: number },
  source = 'SPENT'
): Promise<{ state: WalletState; deducted: number }> {
  const current = await getWallet();
  const deducted = Math.min(amountUsd, current.balance);
  const state = await setWalletBalance(current.balance - deducted, {
    lastChangeUsd: -deducted,
    lastChangeSource: source,
    ...(localContext ? { localCurrency: localContext.currency, localRate: localContext.rate } : {}),
  });
  return { state, deducted };
}

export async function resetWallet(startingBalance?: number): Promise<WalletState> {
  const current = await getWallet();
  const state: WalletState = {
    balance: Math.round(Math.max(0, startingBalance ?? DEFAULT_WALLET_BALANCE) * 100) / 100,
    updatedAt: Date.now(),
    localCurrency: current.localCurrency,
    localRate: current.localRate,
  };
  await Promise.all([kv.set(WALLET_KEY, state), kv.set(CHALLENGES_MODIFIED_KEY, Date.now())]);
  return state;
}

// ── Challenges ────────────────────────────────────────────────────────────────

async function getChallengesState(): Promise<ChallengesState> {
  const raw = await kv.get<ChallengesState>(CHALLENGES_KEY);
  if (!raw || !Array.isArray(raw.challenges)) {
    return { challenges: [], nextId: 1 };
  }

  // Auto-expire active challenges whose timer has run out → timedOut (60s grace period).
  const now = Date.now();
  let anyExpired = false;
  for (const c of raw.challenges) {
    if (c.status === 'active' && c.expiresAt && c.expiresAt < now) {
      c.status = 'timedOut';
      c.resolvedAt = now;
      anyExpired = true;
    }
  }

  // Auto-deduct + delete timedOut challenges past the 60s grace period.
  const GRACE_MS = 60_000;
  const toDelete: number[] = [];
  for (const c of raw.challenges) {
    if (c.status === 'timedOut' && c.resolvedAt && now - c.resolvedAt >= GRACE_MS) {
      // Atomic claim: only one concurrent request deducts per challenge.
      const claimKey = `challenge_auto_deduct:${c.id}`;
      const claimed = await kv.set(claimKey, 1, { nx: true, ex: 7200 });
      if (claimed !== null) {
        if (c.bounty > 0) await deductFromWallet(c.bounty, undefined, 'CHALLENGE FAILED');
        const bountyStr = c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2);
        void getValidAccessToken().then((token) => {
          if (token) return sendKickChatMessage(token, `⏰ Challenge timed out: $${bountyStr} — ${c.description}`);
        }).catch(() => {});
      }
      toDelete.push(c.id);
    }
  }
  if (toDelete.length > 0) {
    raw.challenges = raw.challenges.filter((c) => !toDelete.includes(c.id));
    anyExpired = true;
  }

  if (anyExpired) {
    // Save without triggering a full modified broadcast — just persist the update.
    await kv.set(CHALLENGES_KEY, raw);
    await kv.set(CHALLENGES_MODIFIED_KEY, now);
  }

  return raw;
}

async function saveChallengesState(state: ChallengesState): Promise<void> {
  await Promise.all([
    kv.set(CHALLENGES_KEY, state),
    kv.set(CHALLENGES_MODIFIED_KEY, Date.now()),
  ]);
}

/** Public alias for API route edits (status/desc/bounty/expiresAt). */
export async function setChallengesState(state: ChallengesState): Promise<void> {
  return saveChallengesState(state);
}

export async function getChallenges(): Promise<ChallengesState> {
  return getChallengesState();
}

export async function addChallenge(
  bounty: number,
  description: string,
  expiresAt?: number
): Promise<ChallengeItem> {
  const state = await getChallengesState();
  const item: ChallengeItem = {
    id: state.nextId,
    description,
    bounty: Math.round(Math.max(0, bounty) * 100) / 100,
    status: 'active',
    createdAt: Date.now(),
    ...(expiresAt ? { expiresAt } : {}),
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
  const idx = state.challenges.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const challenge = { ...state.challenges[idx] };
  const prevStatus = challenge.status;
  // Remove immediately — completed/failed challenges don't stay on the board
  state.challenges.splice(idx, 1);
  await saveChallengesState(state);
  // Wallet: credit on completion, deduct on failure (idempotent guard via prevStatus)
  if (status === 'completed' && prevStatus !== 'completed' && challenge.bounty > 0) {
    await addToWallet(challenge.bounty, { source: 'CHALLENGE' });
  }
  if (status === 'failed' && prevStatus !== 'failed' && challenge.bounty > 0) {
    await deductFromWallet(challenge.bounty, undefined, 'CHALLENGE FAILED');
  }
  return { ...challenge, status, resolvedAt: Date.now() };
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
  state.challenges = state.challenges.filter((c) => c.status === 'active' || c.status === 'timedOut');
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
