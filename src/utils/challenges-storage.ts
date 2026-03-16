import { kv } from '@/lib/kv';
import type { ChallengeItem, ChallengesState, WalletState } from '@/types/challenges';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCreatorId } from '@/lib/creator-id';

export const CHALLENGES_KEY = 'stream_challenges';
export const WALLET_KEY = 'stream_wallet';
export const CHALLENGES_MODIFIED_KEY = 'stream_challenges_modified';

const DEFAULT_WALLET_BALANCE = 15;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToMs(iso: string | null | undefined): number | undefined {
  return iso ? new Date(iso).getTime() : undefined;
}

function rowToItem(row: Record<string, unknown>): ChallengeItem {
  return {
    id: row.seq as number,
    description: row.description as string,
    bounty: Number(row.bounty),
    status: row.status as ChallengeItem['status'],
    createdAt: isoToMs(row.created_at as string) ?? Date.now(),
    ...(row.expires_at ? { expiresAt: isoToMs(row.expires_at as string) } : {}),
    ...(row.resolved_at ? { resolvedAt: isoToMs(row.resolved_at as string) } : {}),
    ...(row.buyer_username ? { buyerUsername: row.buyer_username as string } : {}),
    ...(row.steps_target != null ? { stepsTarget: row.steps_target as number } : {}),
    ...(row.distance_target != null ? { distanceTarget: row.distance_target as number } : {}),
  };
}

function itemToRow(item: ChallengeItem, creatorId: string) {
  return {
    creator_id: creatorId,
    seq: item.id,
    description: item.description,
    bounty: item.bounty,
    status: item.status,
    created_at: new Date(item.createdAt).toISOString(),
    ...(item.expiresAt ? { expires_at: new Date(item.expiresAt).toISOString() } : { expires_at: null }),
    ...(item.resolvedAt ? { resolved_at: new Date(item.resolvedAt).toISOString() } : { resolved_at: null }),
    ...(item.buyerUsername ? { buyer_username: item.buyerUsername } : { buyer_username: null }),
    ...(item.stepsTarget != null ? { steps_target: item.stepsTarget } : { steps_target: null }),
    ...(item.distanceTarget != null ? { distance_target: item.distanceTarget } : { distance_target: null }),
  };
}

// ── Wallet ────────────────────────────────────────────────────────────────────

export async function getWallet(): Promise<WalletState> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data } = await supabase.from('creator_settings')
          .select('wallet_balance,wallet_updated_at,wallet_last_change_usd,wallet_last_change_source,wallet_local_currency,wallet_local_rate')
          .eq('creator_id', creatorId).single();
        if (data) {
          return {
            balance: Number(data.wallet_balance ?? DEFAULT_WALLET_BALANCE),
            updatedAt: isoToMs(data.wallet_updated_at as string) ?? Date.now(),
            ...(data.wallet_last_change_usd != null ? { lastChangeUsd: Number(data.wallet_last_change_usd) } : {}),
            ...(data.wallet_last_change_source ? { lastChangeSource: data.wallet_last_change_source as string } : {}),
            ...(data.wallet_local_currency ? { localCurrency: data.wallet_local_currency as string } : {}),
            ...(data.wallet_local_rate != null ? { localRate: Number(data.wallet_local_rate) } : {}),
          };
        }
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const raw = await kv.get<WalletState>(WALLET_KEY);
  if (!raw || typeof raw.balance !== 'number') {
    return { balance: DEFAULT_WALLET_BALANCE, updatedAt: Date.now() };
  }
  return raw;
}

export async function setWalletBalance(
  balance: number,
  opts?: { lastChangeUsd?: number; lastChangeLocalAmount?: number; lastChangeSource?: string; localCurrency?: string; localRate?: number }
): Promise<WalletState> {
  const newBal = Math.round(Math.max(0, balance) * 100) / 100;
  const now = Date.now();
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        await supabase.from('creator_settings').update({
          wallet_balance: newBal,
          wallet_updated_at: new Date(now).toISOString(),
          ...(opts?.lastChangeUsd !== undefined ? { wallet_last_change_usd: opts.lastChangeUsd } : {}),
          ...(opts?.lastChangeSource ? { wallet_last_change_source: opts.lastChangeSource } : {}),
          ...(opts?.localCurrency ? { wallet_local_currency: opts.localCurrency } : {}),
          ...(opts?.localRate != null ? { wallet_local_rate: opts.localRate } : {}),
        }).eq('creator_id', creatorId);
        void kv.set(CHALLENGES_MODIFIED_KEY, now);
        return {
          balance: newBal,
          updatedAt: now,
          ...(opts?.lastChangeUsd !== undefined ? { lastChangeUsd: opts.lastChangeUsd } : {}),
          ...(opts?.lastChangeLocalAmount !== undefined ? { lastChangeLocalAmount: opts.lastChangeLocalAmount } : {}),
          ...(opts?.lastChangeSource ? { lastChangeSource: opts.lastChangeSource } : {}),
          ...(opts?.localCurrency ? { localCurrency: opts.localCurrency } : {}),
          ...(opts?.localRate != null ? { localRate: opts.localRate } : {}),
        };
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const current = await kv.get<WalletState>(WALLET_KEY) ?? { balance: DEFAULT_WALLET_BALANCE, updatedAt: now };
  const state: WalletState = {
    balance: newBal,
    updatedAt: now,
    ...(opts?.lastChangeUsd !== undefined ? { lastChangeUsd: opts.lastChangeUsd } : {}),
    ...(opts?.lastChangeLocalAmount !== undefined ? { lastChangeLocalAmount: opts.lastChangeLocalAmount } : {}),
    ...(opts?.lastChangeSource ? { lastChangeSource: opts.lastChangeSource } : {}),
    localCurrency: opts?.localCurrency ?? current.localCurrency,
    localRate: opts?.localRate ?? current.localRate,
  };
  await Promise.all([kv.set(WALLET_KEY, state), kv.set(CHALLENGES_MODIFIED_KEY, now)]);
  return state;
}

export async function addToWallet(
  amountUsd: number,
  opts?: { source?: string }
): Promise<WalletState> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data: newBal } = await supabase.rpc('adjust_wallet_balance', {
          p_creator_id: creatorId,
          p_delta: amountUsd,
          p_source: opts?.source ?? 'ADD',
        });
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return {
          balance: Number(newBal ?? 0),
          updatedAt: Date.now(),
          lastChangeUsd: amountUsd,
          ...(opts?.source ? { lastChangeSource: opts.source } : {}),
        };
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const current = await getWallet();
  return setWalletBalance(current.balance + amountUsd, {
    lastChangeUsd: amountUsd,
    ...(opts?.source ? { lastChangeSource: opts.source } : {}),
  });
}

export async function deductFromWallet(
  amountUsd: number,
  localContext?: { currency: string; rate: number; localAmount?: number },
  source = 'SPENT'
): Promise<{ state: WalletState; deducted: number }> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const current = await getWallet();
        const deducted = Math.min(amountUsd, current.balance);
        const { data: newBal } = await supabase.rpc('adjust_wallet_balance', {
          p_creator_id: creatorId,
          p_delta: -deducted,
          p_source: source,
          ...(localContext ? { p_currency: localContext.currency, p_rate: localContext.rate } : {}),
        });
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return {
          state: {
            balance: Number(newBal ?? 0),
            updatedAt: Date.now(),
            lastChangeUsd: -deducted,
            lastChangeSource: source,
            ...(localContext ? { localCurrency: localContext.currency, localRate: localContext.rate } : {}),
            ...(localContext?.localAmount != null ? { lastChangeLocalAmount: -localContext.localAmount } : {}),
          },
          deducted,
        };
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const current = await getWallet();
  const deducted = Math.min(amountUsd, current.balance);
  const state = await setWalletBalance(current.balance - deducted, {
    lastChangeUsd: -deducted,
    lastChangeSource: source,
    ...(localContext ? { localCurrency: localContext.currency, localRate: localContext.rate } : {}),
    ...(localContext?.localAmount != null ? { lastChangeLocalAmount: -localContext.localAmount } : {}),
  });
  return { state, deducted };
}

export async function resetWallet(startingBalance?: number): Promise<WalletState> {
  return setWalletBalance(startingBalance ?? DEFAULT_WALLET_BALANCE);
}

// ── Challenges ────────────────────────────────────────────────────────────────

async function getChallengesState(): Promise<ChallengesState> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data: rows } = await supabase.from('challenges')
          .select('*')
          .eq('creator_id', creatorId)
          .in('status', ['active', 'timedOut'])
          .order('seq', { ascending: true });

        if (rows) {
          const now = Date.now();
          let modified = false;

          // Auto-expire active challenges whose timer ran out
          const toExpire = rows.filter(
            (r) => r.status === 'active' && r.expires_at && new Date(r.expires_at as string).getTime() < now
          );
          if (toExpire.length > 0) {
            await supabase.from('challenges')
              .update({ status: 'timedOut', resolved_at: new Date(now).toISOString() })
              .in('id', toExpire.map((r) => r.id));
            for (const r of toExpire) {
              r.status = 'timedOut';
              r.resolved_at = new Date(now).toISOString();
            }
            modified = true;
          }

          // Auto-deduct + delete timedOut challenges past 60s grace period.
          // Uses UPDATE WHERE auto_deducted = false as atomic claim (replaces KV nx lock).
          const GRACE_MS = 60_000;
          const toAutoDeduct = rows.filter(
            (r) =>
              r.status === 'timedOut' &&
              r.resolved_at &&
              now - new Date(r.resolved_at as string).getTime() >= GRACE_MS &&
              !r.auto_deducted
          );
          const claimedIds: number[] = [];
          for (const r of toAutoDeduct) {
            const { data: claimed } = await supabase.from('challenges')
              .update({ auto_deducted: true })
              .eq('id', r.id as number)
              .eq('auto_deducted', false)
              .select('id');
            if (claimed && claimed.length > 0) {
              claimedIds.push(r.id as number);
              if (Number(r.bounty) > 0) {
                await deductFromWallet(Number(r.bounty), undefined, 'CHALLENGE FAILED');
              }
              const bountyStr =
                Number(r.bounty) % 1 === 0
                  ? Number(r.bounty).toFixed(0)
                  : Number(r.bounty).toFixed(2);
              void getValidAccessToken()
                .then((token) => {
                  if (token)
                    return sendKickChatMessage(
                      token,
                      `⏰ Challenge timed out: $${bountyStr} — ${r.description as string}`
                    );
                })
                .catch(() => {});
            }
          }
          if (claimedIds.length > 0) {
            await supabase.from('challenges').delete().in('id', claimedIds);
            modified = true;
          }

          if (modified) void kv.set(CHALLENGES_MODIFIED_KEY, now);

          const claimedSet = new Set(claimedIds);
          const liveRows = rows.filter((r) => !claimedSet.has(r.id as number));
          const challenges = liveRows.map((r) => rowToItem(r as unknown as Record<string, unknown>));
          return { challenges, nextId: 0 };
        }
      }
    }
  } catch { /* fall through */ }

  // KV fallback (original logic)
  const raw = await kv.get<ChallengesState>(CHALLENGES_KEY);
  if (!raw || !Array.isArray(raw.challenges)) return { challenges: [], nextId: 1 };

  const now = Date.now();
  let anyExpired = false;
  for (const c of raw.challenges) {
    if (c.status === 'active' && c.expiresAt && c.expiresAt < now) {
      c.status = 'timedOut';
      c.resolvedAt = now;
      anyExpired = true;
    }
  }

  const GRACE_MS = 60_000;
  const toDelete: number[] = [];
  for (const c of raw.challenges) {
    if (c.status === 'timedOut' && c.resolvedAt && now - c.resolvedAt >= GRACE_MS) {
      const claimKey = `challenge_auto_deduct:${c.id}`;
      const claimed = await kv.set(claimKey, 1, { nx: true, ex: 7200 });
      if (claimed !== null) {
        if (c.bounty > 0) await deductFromWallet(c.bounty, undefined, 'CHALLENGE FAILED');
        const bountyStr = c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2);
        void getValidAccessToken()
          .then((token) => {
            if (token)
              return sendKickChatMessage(token, `⏰ Challenge timed out: $${bountyStr} — ${c.description}`);
          })
          .catch(() => {});
      }
      toDelete.push(c.id);
    }
  }
  if (toDelete.length > 0) {
    raw.challenges = raw.challenges.filter((c) => !toDelete.includes(c.id));
    anyExpired = true;
  }

  if (anyExpired) {
    await kv.set(CHALLENGES_KEY, raw);
    await kv.set(CHALLENGES_MODIFIED_KEY, now);
  }

  return raw;
}

async function saveChallengesState(state: ChallengesState): Promise<void> {
  await Promise.all([kv.set(CHALLENGES_KEY, state), kv.set(CHALLENGES_MODIFIED_KEY, Date.now())]);
}

/** Public alias for API route edits (reactivate, description/bounty). Upserts each challenge to Supabase. */
export async function setChallengesState(state: ChallengesState): Promise<void> {
  try {
    if (isSupabaseConfigured() && state.challenges.length > 0) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const rows = state.challenges.map((item) => itemToRow(item, creatorId));
        await supabase.from('challenges')
          .upsert(rows, { onConflict: 'creator_id,seq' });
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return;
      }
    }
  } catch { /* fall through */ }
  return saveChallengesState(state);
}

export async function getChallenges(): Promise<ChallengesState> {
  return getChallengesState();
}

const MAX_ACTIVE_CHALLENGES = 5;

export async function addChallenge(
  bounty: number,
  description: string,
  expiresAt?: number,
  opts?: { buyerUsername?: string; stepsTarget?: number; distanceTarget?: number }
): Promise<ChallengeItem | null> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { count } = await supabase.from('challenges')
          .select('id', { count: 'exact', head: true })
          .eq('creator_id', creatorId)
          .eq('status', 'active');
        if ((count ?? 0) >= MAX_ACTIVE_CHALLENGES) return null;

        const { data: seq } = await supabase.rpc('next_challenge_seq', { p_creator_id: creatorId });
        const { data: row } = await supabase.from('challenges').insert({
          creator_id: creatorId,
          seq: seq as number,
          description,
          bounty: Math.round(Math.max(0, bounty) * 100) / 100,
          status: 'active',
          ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
          ...(opts?.buyerUsername ? { buyer_username: opts.buyerUsername } : {}),
          ...(opts?.stepsTarget != null ? { steps_target: opts.stepsTarget } : {}),
          ...(opts?.distanceTarget != null ? { distance_target: opts.distanceTarget } : {}),
        }).select('*').single();
        if (row) {
          void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
          return rowToItem(row as unknown as Record<string, unknown>);
        }
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const state = await getChallengesState();
  const activeCount = state.challenges.filter((c) => c.status === 'active').length;
  if (activeCount >= MAX_ACTIVE_CHALLENGES) return null;
  const item: ChallengeItem = {
    id: state.nextId,
    description,
    bounty: Math.round(Math.max(0, bounty) * 100) / 100,
    status: 'active',
    createdAt: Date.now(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(opts?.buyerUsername ? { buyerUsername: opts.buyerUsername } : {}),
    ...(opts?.stepsTarget != null ? { stepsTarget: opts.stepsTarget } : {}),
    ...(opts?.distanceTarget != null ? { distanceTarget: opts.distanceTarget } : {}),
  };
  state.challenges.push(item);
  state.nextId += 1;
  await saveChallengesState(state);
  return item;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a random steps or distance challenge for the stream. */
export function makeMovementChallenge(): { description: string; bounty: number; opts: { stepsTarget?: number; distanceTarget?: number } } {
  if (Math.random() < 0.5) {
    const steps = randomInt(8, 12) * 1_000;
    return { description: `${steps.toLocaleString()} steps`, bounty: 20, opts: { stepsTarget: steps } };
  } else {
    const km = randomInt(6, 10);
    return { description: `${km} km`, bounty: 20, opts: { distanceTarget: km } };
  }
}

/** Generate a random fitness challenge for the stream. */
export function makeFitnessChallenge(): { description: string; bounty: number } {
  const options = [
    () => `${randomInt(10, 30)} pushups`,
    () => `${randomInt(20, 50)} squats`,
    () => `${randomInt(30, 120)}s plank`,
    () => `${randomInt(15, 40)} sit-ups`,
    () => `${randomInt(10, 25)} burpees`,
  ];
  return { description: randomPick(options)(), bounty: 10 };
}

const SOCIAL_TASKS = [
  'Learn something new from a stranger',
  'Find a local\'s favourite hidden spot',
  'Try a street food you\'ve never had',
  'Learn a new local word or phrase',
  'Take a photo with a local',
  'Explore an unusual nearby shop',
  'Get a restaurant rec from a local and go',
  'Greet 5 strangers',
  'Ask a local to name a nearby landmark',
  'Follow directions from a stranger',
  'Learn a local\'s daily routine',
  'Find and tip a street performer',
  'Learn a shop\'s history from its owner',
  'Order blind from the menu',
  'Ask what tourists always get wrong here',
  'Chat with someone at a café or stall',
  'Ask a local about their weekends',
  'Ask 3 locals their favourite dish',
  'Ask a long-time local what\'s changed here',
  'Get the best nearby view tip from a local',
];

/** Generate a random social task challenge for the stream. */
export function makeSocialChallenge(): { description: string; bounty: number } {
  return { description: randomPick(SOCIAL_TASKS), bounty: 15 };
}

/** Add randomised default challenges on stream start/reset. */
export async function addDefaultChallenges(): Promise<void> {
  const movement = makeMovementChallenge();
  const fitness = makeFitnessChallenge();
  const social = makeSocialChallenge();
  await addChallenge(movement.bounty, movement.description, undefined, movement.opts);
  await addChallenge(fitness.bounty, fitness.description);
  await addChallenge(social.bounty, social.description);
}

/**
 * Check active challenges with a stepsTarget or distanceTarget and auto-complete when reached.
 * Called after each wellness import.
 */
export async function checkAndCompleteStepsChallenges(
  currentSteps: number,
  currentDistanceKm?: number
): Promise<void> {
  const state = await getChallengesState();
  const toComplete = state.challenges.filter((c) => {
    if (c.status !== 'active') return false;
    if (c.stepsTarget != null && currentSteps >= c.stepsTarget) return true;
    if (c.distanceTarget != null && currentDistanceKm != null && currentDistanceKm >= c.distanceTarget) return true;
    return false;
  });
  for (const c of toComplete) {
    await updateChallengeStatus(c.id, 'completed');
  }
}

export async function updateChallengeStatus(
  id: number,
  status: 'completed' | 'failed'
): Promise<ChallengeItem | null> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data: rows } = await supabase.from('challenges')
          .select('*')
          .eq('creator_id', creatorId)
          .eq('seq', id);
        const row = rows?.[0];
        if (!row) return null;
        const prevStatus = row.status as string;
        await supabase.from('challenges')
          .delete()
          .eq('creator_id', creatorId)
          .eq('seq', id);
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        const item = rowToItem(row as unknown as Record<string, unknown>);
        if (status === 'completed' && prevStatus !== 'completed' && item.bounty > 0) {
          await addToWallet(item.bounty, { source: 'CHALLENGE' });
        }
        if (status === 'failed' && prevStatus !== 'failed' && item.bounty > 0) {
          await deductFromWallet(item.bounty, undefined, 'CHALLENGE FAILED');
        }
        return { ...item, status, resolvedAt: Date.now() };
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const state = await getChallengesState();
  const idx = state.challenges.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const challenge = { ...state.challenges[idx] };
  const prevStatus = challenge.status;
  state.challenges.splice(idx, 1);
  await saveChallengesState(state);
  if (status === 'completed' && prevStatus !== 'completed' && challenge.bounty > 0) {
    await addToWallet(challenge.bounty, { source: 'CHALLENGE' });
  }
  if (status === 'failed' && prevStatus !== 'failed' && challenge.bounty > 0) {
    await deductFromWallet(challenge.bounty, undefined, 'CHALLENGE FAILED');
  }
  return { ...challenge, status, resolvedAt: Date.now() };
}

export async function removeChallenge(id: number): Promise<ChallengeItem | null> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data: rows } = await supabase.from('challenges')
          .select('*')
          .eq('creator_id', creatorId)
          .eq('seq', id);
        const row = rows?.[0];
        if (!row) return null;
        await supabase.from('challenges').delete().eq('creator_id', creatorId).eq('seq', id);
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return rowToItem(row as unknown as Record<string, unknown>);
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const state = await getChallengesState();
  const idx = state.challenges.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const [removed] = state.challenges.splice(idx, 1);
  await saveChallengesState(state);
  return removed;
}

export async function clearResolvedChallenges(): Promise<number> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        const { data: removed } = await supabase.from('challenges')
          .delete()
          .eq('creator_id', creatorId)
          .in('status', ['completed', 'failed'])
          .select('id');
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return removed?.length ?? 0;
      }
    }
  } catch { /* fall through */ }
  // KV fallback
  const state = await getChallengesState();
  const before = state.challenges.length;
  state.challenges = state.challenges.filter((c) => c.status === 'active' || c.status === 'timedOut');
  const removedCount = before - state.challenges.length;
  if (removedCount > 0) await saveChallengesState(state);
  return removedCount;
}

export async function resetChallenges(): Promise<void> {
  try {
    if (isSupabaseConfigured()) {
      const creatorId = await getCreatorId();
      if (creatorId) {
        await supabase.from('challenges').delete().eq('creator_id', creatorId);
        void kv.set(CHALLENGES_MODIFIED_KEY, Date.now());
        return;
      }
    }
  } catch { /* fall through */ }
  await Promise.all([kv.del(CHALLENGES_KEY), kv.set(CHALLENGES_MODIFIED_KEY, Date.now())]);
}
