/**
 * Broadcast overlay data (settings + poll + leaderboard + alerts) to SSE clients
 * when alerts or leaderboard change. Gives overlays instant updates instead of
 * waiting for the 2s poll.
 */

import { kv } from '@vercel/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { getGamblingLeaderboardTop } from '@/utils/blackjack-storage';
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
    const gamblingEnabled = merged.gamblingEnabled !== false;
    const showLeaderboard = merged.showLeaderboard !== false && gamblingEnabled;
    const needGoals = merged.showSubGoal || merged.showKicksGoal;
    const leaderboardTopN = merged.gamblingLeaderboardTopN ?? merged.leaderboardTopN ?? 5;
    const [gamblingLeaderboardTop, overlayAlerts, streamGoals] = await Promise.all([
      showLeaderboard ? getGamblingLeaderboardTop(leaderboardTopN) : [],
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
      needGoals ? getStreamGoals() : { subs: 0, kicks: 0 },
    ]);
    const combined = { ...merged, gamblingLeaderboardTop, overlayAlerts, streamGoals };
    await broadcastSettings(combined);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[alerts-broadcast] Failed to broadcast:', err);
    }
  }
}
