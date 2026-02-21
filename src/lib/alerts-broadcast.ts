/**
 * Broadcast overlay data (settings + poll + leaderboard + alerts) to SSE clients
 * when alerts or leaderboard change. Gives overlays instant updates instead of
 * waiting for the 2s poll.
 */

import { kv } from '@vercel/kv';
import { mergeSettingsWithDefaults, getLeaderboardDisplayMode } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { getLeaderboardTop } from '@/utils/leaderboard-storage';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { POLL_STATE_KEY } from '@/types/poll';
import type { PollState } from '@/types/poll';

export async function broadcastAlertsAndLeaderboard(): Promise<void> {
  try {
    const [settings, rawPoll] = await kv.mget<[Record<string, unknown> | null, PollState | null]>(
      'overlay_settings',
      POLL_STATE_KEY
    );
    const merged = mergeSettingsWithDefaults({
      ...(settings && typeof settings === 'object' ? settings : {}),
      pollState: rawPoll ?? null,
    });
    const ld = getLeaderboardDisplayMode(merged);
    const [leaderboardTop, overlayAlerts] = await Promise.all([
      ld !== 'hidden' ? getLeaderboardTop(merged.leaderboardTopN ?? 5) : [],
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
    ]);
    const combined = { ...merged, leaderboardTop, overlayAlerts };
    await broadcastSettings(combined);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[alerts-broadcast] Failed to broadcast:', err);
    }
  }
}
