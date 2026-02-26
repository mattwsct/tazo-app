/**
 * Earned-tazos vault: weekly / monthly / lifetime leaderboards.
 * These track only EARNED tazos (won in games, drops, etc.) — not the 100 starting balance.
 * Keys use auto-rotating identifiers so no cron resets are needed.
 *
 * Weekly key:   vault:weekly:YYYY-Www  (e.g. vault:weekly:2026-W09) — TTL 14 days
 * Monthly key:  vault:monthly:YYYY-MM  (e.g. vault:monthly:2026-02) — TTL 62 days
 * Lifetime key: vault:lifetime                                        — no TTL
 */

import { kv } from '@vercel/kv';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';

const DISPLAY_NAMES_KEY = 'leaderboard_display_names';
const VAULT_WEEKLY_PREFIX = 'vault:weekly:';
const VAULT_MONTHLY_PREFIX = 'vault:monthly:';
const VAULT_LIFETIME_KEY = 'vault:lifetime';
const WEEKLY_TTL_SEC = 14 * 24 * 3600;
const MONTHLY_TTL_SEC = 62 * 24 * 3600;

// Simple module-level timezone cache (5-minute TTL) to avoid a KV read on every award
let _tzCache: { value: string; expiresAt: number } | null = null;

export async function getStreamerTimezone(): Promise<string> {
  const now = Date.now();
  if (_tzCache && _tzCache.expiresAt > now) return _tzCache.value;
  try {
    const settings = await kv.get<{ streamerTimezone?: string }>('overlay_settings');
    const tz = settings?.streamerTimezone || 'UTC';
    _tzCache = { value: tz, expiresAt: now + 5 * 60 * 1000 };
    return tz;
  } catch {
    return 'UTC';
  }
}

function getLocalWeekKey(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value, 10);
  const month = parseInt(parts.find(p => p.type === 'month')!.value, 10);
  const day = parseInt(parts.find(p => p.type === 'day')!.value, 10);

  // ISO week starts Monday — find the Monday of this week
  const localDate = new Date(year, month - 1, day);
  const dow = localDate.getDay(); // 0=Sun
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(localDate);
  monday.setDate(localDate.getDate() - mondayOffset);

  const startOfYear = new Date(monday.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((monday.getTime() - startOfYear.getTime()) / 86400000 + 1) / 7,
  );
  return `${monday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getLocalMonthKey(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  return `${year}-${month}`;
}

/**
 * Record earned tazos for a user across weekly, monthly, and lifetime boards.
 * Call this whenever tazos are EARNED (not for the 100 starting tazos).
 */
export async function recordTazosEarned(username: string, amount: number): Promise<void> {
  if (amount <= 0 || !username) return;
  try {
    const timezone = await getStreamerTimezone();
    const weekKey = `${VAULT_WEEKLY_PREFIX}${getLocalWeekKey(timezone)}`;
    const monthKey = `${VAULT_MONTHLY_PREFIX}${getLocalMonthKey(timezone)}`;

    await Promise.all([
      kv.zincrby(weekKey, amount, username),
      kv.zincrby(monthKey, amount, username),
      kv.zincrby(VAULT_LIFETIME_KEY, amount, username),
    ]);

    // Refresh TTL on rolling keys each time they're written
    await Promise.all([
      kv.expire(weekKey, WEEKLY_TTL_SEC),
      kv.expire(monthKey, MONTHLY_TTL_SEC),
    ]);
  } catch { /* silent — never break a game win */ }
}

export type EarnedPeriod = 'weekly' | 'monthly' | 'lifetime';

/**
 * Return top N earners for the given period.
 * Always respects the leaderboard exclusion list (bots etc.) — fetches it
 * automatically unless a pre-fetched set is supplied by the caller.
 */
export async function getEarnedLeaderboard(
  period: EarnedPeriod,
  n: number,
  excludedUsers?: Set<string>,
): Promise<{ username: string; earned: number }[]> {
  try {
    const [timezone, excluded] = await Promise.all([
      getStreamerTimezone(),
      excludedUsers ?? getLeaderboardExclusions(),
    ]);

    let key: string;
    if (period === 'weekly') key = `${VAULT_WEEKLY_PREFIX}${getLocalWeekKey(timezone)}`;
    else if (period === 'monthly') key = `${VAULT_MONTHLY_PREFIX}${getLocalMonthKey(timezone)}`;
    else key = VAULT_LIFETIME_KEY;

    const displayNames = (await kv.hgetall<Record<string, string>>(DISPLAY_NAMES_KEY)) ?? {};
    const fetchCount = n + excluded.size + 10;
    const raw = await kv.zrange(key, 0, fetchCount - 1, { rev: true, withScores: true });
    if (!raw || !Array.isArray(raw)) return [];

    const result: { username: string; earned: number }[] = [];
    for (let i = 0; i < raw.length && result.length < n; i += 2) {
      const user = String(raw[i] ?? '').trim().toLowerCase();
      if (!user || excluded.has(user)) continue;
      result.push({
        username: displayNames[user] ?? user,
        earned: Math.round(Number(raw[i + 1] ?? 0)),
      });
    }
    return result;
  } catch {
    return [];
  }
}
