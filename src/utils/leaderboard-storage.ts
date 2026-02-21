/**
 * Leaderboard storage: per-stream points, reset on stream start.
 * Uses Redis sorted set for O(log n) leaderboard queries.
 * Point weights: chat=1 (every message), first chatter=25, poll vote=2, create poll=10,
 * follow=5, new sub=15, resub=10, gift sub=12 each, kicks: 10 pts per 100 kicks ($1).
 */

import { kv } from '@vercel/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';

const LEADERBOARD_SCORES_KEY = 'leaderboard_scores';
const LEADERBOARD_FIRST_CHATTER_KEY = 'leaderboard_first_chatter';
const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';

export const POINT_WEIGHTS = {
  chat: 1,
  firstChatter: 25,
  pollVote: 2,
  createPoll: 10,
  follow: 5,
  newSub: 15,
  resub: 10,
  giftSub: 12,
  /** 100 kicks = $1 → 10 points per $1 */
  kicksPer100: 10,
} as const;

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Parse comma/newline-separated usernames into lowercase set. Exported for callers who already have settings. */
export function parseExcludedBots(raw: string | null | undefined): Set<string> {
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Get usernames to exclude from leaderboard (from configured ignore list). Always reads fresh from KV. */
export async function getLeaderboardExclusions(): Promise<Set<string>> {
  try {
    const settingsRaw = await kv.get<Record<string, unknown> | null>('overlay_settings');
    const settings = settingsRaw as { leaderboardExcludedBots?: string } | null;
    return parseExcludedBots(settings?.leaderboardExcludedBots);
  } catch {
    return new Set();
  }
}

/** Reset leaderboard when stream starts (called from onStreamStarted flow). */
export async function resetLeaderboardOnStreamStart(): Promise<void> {
  try {
    await kv.del(LEADERBOARD_SCORES_KEY);
    await kv.del(LEADERBOARD_FIRST_CHATTER_KEY);
    await kv.del(LEADERBOARD_DISPLAY_NAMES_KEY);
    console.log('[Leaderboard] Reset on stream start at', new Date().toISOString());
  } catch (e) {
    console.warn('[Leaderboard] Failed to reset on stream start:', e);
  }
}

async function ensureSessionStarted(): Promise<void> {
  const started = await getStreamStartedAt();
  if (!started) {
    await onStreamStarted();
  }
}

/** Store display name from Kick (original casing). Prefer mixed-case over all-lowercase. */
async function setDisplayName(normalized: string, display: string): Promise<void> {
  const trimmed = display.trim();
  if (!trimmed) return;
  try {
    const existing = await kv.hget<string>(LEADERBOARD_DISPLAY_NAMES_KEY, normalized);
    const hasMixedCase = trimmed !== trimmed.toLowerCase();
    if (!existing || (hasMixedCase && existing === existing.toLowerCase())) {
      await kv.hset(LEADERBOARD_DISPLAY_NAMES_KEY, { [normalized]: trimmed });
    }
  } catch { /* ignore */ }
}

/** Add points for a chat message (1 pt per message; first chatter gets +25). */
export async function addChatPoints(username: string): Promise<{ points: number; isFirstChatter: boolean }> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return { points: 0, isFirstChatter: false };
  await ensureSessionStarted();

  const firstChatter = await kv.get<string>(LEADERBOARD_FIRST_CHATTER_KEY);
  const isFirstChatter = !firstChatter;

  let points = POINT_WEIGHTS.chat;
  if (isFirstChatter) {
    await kv.set(LEADERBOARD_FIRST_CHATTER_KEY, user);
    points += POINT_WEIGHTS.firstChatter;
  }

  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    setDisplayName(user, username),
  ]);

  return { points, isFirstChatter };
}

/** Add points for poll vote (2) or creating poll (10). */
export async function addPollPoints(username: string, action: 'vote' | 'create'): Promise<void> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = action === 'vote' ? POINT_WEIGHTS.pollVote : POINT_WEIGHTS.createPoll;
  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    setDisplayName(user, username),
  ]);
}

/** Add points for follow (5). */
export async function addFollowPoints(username: string): Promise<void> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, POINT_WEIGHTS.follow, user),
    setDisplayName(user, username),
  ]);
}

/** Add points for new sub (15) or resub (10). */
export async function addSubPoints(username: string, isResub: boolean): Promise<void> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = isResub ? POINT_WEIGHTS.resub : POINT_WEIGHTS.newSub;
  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    setDisplayName(user, username),
  ]);
}

/** Add points for gift sub – gifter gets 12 per sub. */
export async function addGiftSubPoints(gifterUsername: string, count: number): Promise<void> {
  const user = normalizeUsername(gifterUsername);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = POINT_WEIGHTS.giftSub * count;
  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    setDisplayName(user, gifterUsername),
  ]);
}

/** Add points for kicks gifted. 100 kicks = $1 → 10 points per 100 kicks. */
export async function addKicksPoints(senderUsername: string, kicksAmount: number): Promise<void> {
  const user = normalizeUsername(senderUsername);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = Math.max(1, Math.floor(kicksAmount / 100) * POINT_WEIGHTS.kicksPer100);
  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    setDisplayName(user, senderUsername),
  ]);
}

/** Get top N users with points. Returns [{ username, points }, ...]. Excludes broadcaster + configured bots. Uses stored display names for correct capitalization. */
export async function getLeaderboardTop(
  n: number,
  options?: { excludeUsernames?: Set<string> }
): Promise<{ username: string; points: number }[]> {
  try {
    const excluded = options?.excludeUsernames ?? (await getLeaderboardExclusions());
    const [raw, displayNames] = await Promise.all([
      kv.zrange(LEADERBOARD_SCORES_KEY, 0, n + excluded.size + 20, { rev: true, withScores: true }),
      kv.hgetall<Record<string, string>>(LEADERBOARD_DISPLAY_NAMES_KEY),
    ]);
    if (!raw || !Array.isArray(raw)) return [];
    const names = displayNames ?? {};
    const result: { username: string; points: number }[] = [];
    for (let i = 0; i < raw.length && result.length < n; i += 2) {
      const user = String(raw[i] ?? '').trim().toLowerCase();
      if (!user) continue;
      if (excluded.has(user)) continue;
      result.push({
        username: names[user] ?? user,
        points: Math.round(Number(raw[i + 1] ?? 0)),
      });
    }
    // Defensive: filter again in case exclusions were momentarily empty (e.g. during deploy)
    return result.filter((u) => !excluded.has(u.username.trim().toLowerCase()));
  } catch {
    return [];
  }
}

/** Get points for a single user. */
export async function getUserPoints(username: string): Promise<number> {
  try {
    const user = normalizeUsername(username);
    const score = await kv.zscore(LEADERBOARD_SCORES_KEY, user);
    return Math.round(Number(score ?? 0));
  } catch {
    return 0;
  }
}
