/**
 * Leaderboard storage: per-stream points, reset on stream start.
 * Uses Redis sorted set for O(log n) leaderboard queries.
 * Point weights: chat=1 (5s cooldown), first chatter=25, poll vote=2, create poll=10,
 * follow=5, new sub=15, resub=10, gift sub=12 each, kicks: 10 pts per 100 kicks ($1).
 */

import { kv } from '@vercel/kv';
import { getStreamStartedAt, onStreamStarted } from '@/utils/stats-storage';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';

const LEADERBOARD_SCORES_KEY = 'leaderboard_scores';
const LEADERBOARD_FIRST_CHATTER_KEY = 'leaderboard_first_chatter';
const LEADERBOARD_CHAT_COOLDOWN_PREFIX = 'leaderboard_chat:';
const CHAT_COOLDOWN_SEC = 5;

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

function parseExcludedBots(raw: string | null | undefined): Set<string> {
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

const LEADERBOARD_EXCLUSIONS_CACHE_MS = 30_000; // 30s TTL to reduce KV reads
let _exclusionsCache: { data: Set<string>; expires: number; settingsModified: number } | null = null;

/** Get usernames to exclude from leaderboard (broadcaster + configured bots). Cached 30s. */
export async function getLeaderboardExclusions(): Promise<Set<string>> {
  const now = Date.now();
  if (_exclusionsCache && now < _exclusionsCache.expires) {
    return _exclusionsCache.data;
  }
  try {
    const [settingsRaw, broadcaster, settingsModified] = await kv.mget<
      [Record<string, unknown> | null, string | null, number | null]
    >('overlay_settings', KICK_BROADCASTER_SLUG_KEY, 'overlay_settings_modified');
    const mod = settingsModified ?? 0;
    if (_exclusionsCache && mod === _exclusionsCache.settingsModified) {
      _exclusionsCache.expires = now + LEADERBOARD_EXCLUSIONS_CACHE_MS;
      return _exclusionsCache.data;
    }
    const settings = settingsRaw as { leaderboardExcludeBroadcaster?: boolean; leaderboardExcludedBots?: string } | null;
    const excluded = new Set<string>();
    if (broadcaster && typeof broadcaster === 'string') {
      const excludeBroadcaster = settings?.leaderboardExcludeBroadcaster !== false;
      if (excludeBroadcaster) excluded.add(broadcaster.toLowerCase().trim());
    }
    const bots = parseExcludedBots(settings?.leaderboardExcludedBots);
    bots.forEach((b) => excluded.add(b));
    _exclusionsCache = { data: excluded, expires: now + LEADERBOARD_EXCLUSIONS_CACHE_MS, settingsModified: mod };
    return excluded;
  } catch {
    return new Set();
  }
}

/** Call after saving settings to avoid stale exclusion cache. */
export function invalidateLeaderboardExclusionsCache(): void {
  _exclusionsCache = null;
}

/** Reset leaderboard when stream starts (called from onStreamStarted flow). */
export async function resetLeaderboardOnStreamStart(): Promise<void> {
  try {
    await kv.del(LEADERBOARD_SCORES_KEY);
    await kv.del(LEADERBOARD_FIRST_CHATTER_KEY);
    // Chat cooldown keys expire automatically
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

/** Add points for a chat message (1 pt, 5s cooldown; first chatter gets +25). */
export async function addChatPoints(username: string): Promise<{ points: number; isFirstChatter: boolean }> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return { points: 0, isFirstChatter: false };
  await ensureSessionStarted();

  const [firstChatter, cooldownKey] = await Promise.all([
    kv.get<string>(LEADERBOARD_FIRST_CHATTER_KEY),
    kv.get<number>(`${LEADERBOARD_CHAT_COOLDOWN_PREFIX}${user}`),
  ]);

  const now = Date.now();
  const isFirstChatter = !firstChatter;
  const onCooldown = typeof cooldownKey === 'number' && now < cooldownKey;

  if (onCooldown) {
    return { points: 0, isFirstChatter: false };
  }

  let points = POINT_WEIGHTS.chat;
  if (isFirstChatter) {
    await kv.set(LEADERBOARD_FIRST_CHATTER_KEY, user);
    points += POINT_WEIGHTS.firstChatter;
  }

  await Promise.all([
    kv.zincrby(LEADERBOARD_SCORES_KEY, points, user),
    kv.set(`${LEADERBOARD_CHAT_COOLDOWN_PREFIX}${user}`, now + CHAT_COOLDOWN_SEC * 1000, { ex: CHAT_COOLDOWN_SEC + 2 }),
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
  await kv.zincrby(LEADERBOARD_SCORES_KEY, points, user);
}

/** Add points for follow (5). */
export async function addFollowPoints(username: string): Promise<void> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  await kv.zincrby(LEADERBOARD_SCORES_KEY, POINT_WEIGHTS.follow, user);
}

/** Add points for new sub (15) or resub (10). */
export async function addSubPoints(username: string, isResub: boolean): Promise<void> {
  const user = normalizeUsername(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = isResub ? POINT_WEIGHTS.resub : POINT_WEIGHTS.newSub;
  await kv.zincrby(LEADERBOARD_SCORES_KEY, points, user);
}

/** Add points for gift sub – gifter gets 12 per sub. */
export async function addGiftSubPoints(gifterUsername: string, count: number): Promise<void> {
  const user = normalizeUsername(gifterUsername);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = POINT_WEIGHTS.giftSub * count;
  await kv.zincrby(LEADERBOARD_SCORES_KEY, points, user);
}

/** Add points for kicks gifted. 100 kicks = $1 → 10 points per 100 kicks. */
export async function addKicksPoints(senderUsername: string, kicksAmount: number): Promise<void> {
  const user = normalizeUsername(senderUsername);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;
  await ensureSessionStarted();
  const points = Math.max(1, Math.floor(kicksAmount / 100) * POINT_WEIGHTS.kicksPer100);
  await kv.zincrby(LEADERBOARD_SCORES_KEY, points, user);
}

/** Get top N users with points. Returns [{ username, points }, ...]. Excludes broadcaster + configured bots. */
export async function getLeaderboardTop(
  n: number,
  options?: { excludeUsernames?: Set<string> }
): Promise<{ username: string; points: number }[]> {
  try {
    const excluded = options?.excludeUsernames ?? (await getLeaderboardExclusions());
    const raw = await kv.zrange(LEADERBOARD_SCORES_KEY, 0, n + excluded.size + 9, { rev: true, withScores: true });
    if (!raw || !Array.isArray(raw)) return [];
    const result: { username: string; points: number }[] = [];
    for (let i = 0; i < raw.length && result.length < n; i += 2) {
      const user = String(raw[i] ?? '').toLowerCase();
      if (excluded.has(user)) continue;
      result.push({
        username: String(raw[i] ?? ''),
        points: Math.round(Number(raw[i + 1] ?? 0)),
      });
    }
    return result;
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
