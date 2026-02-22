/**
 * Leaderboard storage: display names and exclusion list (shared by chips/gambling leaderboard).
 */

import { kv } from '@vercel/kv';

const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';

/** Get usernames to exclude from leaderboard (from configured ignore list). Always reads fresh from KV. */
export async function getLeaderboardExclusions(): Promise<Set<string>> {
  try {
    const settingsRaw = await kv.get<Record<string, unknown> | null>('overlay_settings');
    const raw = (settingsRaw as { leaderboardExcludedBots?: string } | null)?.leaderboardExcludedBots;
    if (!raw || typeof raw !== 'string') return new Set();
    return new Set(
      raw.split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/** Store display name (original casing) for chips leaderboard display. */
export async function setLeaderboardDisplayName(normalized: string, display: string): Promise<void> {
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
