/**
 * Broadcast overlay data (settings + poll + leaderboard + alerts) to SSE clients
 * when alerts or leaderboard change. Gives overlays instant updates instead of
 * waiting for the 2s poll.
 */

import { kv } from '@vercel/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { getLeaderboardTop, parseExcludedBots } from '@/utils/leaderboard-storage';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { getStreamGoals } from '@/utils/stream-goals-storage';
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
    const showLeaderboard = merged.showLeaderboard !== false;
    const needGoals = merged.showSubGoal || merged.showKicksGoal;
    const excludeUsernames = parseExcludedBots(merged.leaderboardExcludedBots);
    const [leaderboardTop, overlayAlerts, streamGoals] = await Promise.all([
      showLeaderboard ? getLeaderboardTop(merged.leaderboardTopN ?? 5, { excludeUsernames }) : [],
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
      needGoals ? getStreamGoals() : { subs: 0, kicks: 0 },
    ]);
    const combined = { ...merged, leaderboardTop, overlayAlerts, streamGoals };
    await broadcastSettings(combined);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[alerts-broadcast] Failed to broadcast:', err);
    }
  }
}
