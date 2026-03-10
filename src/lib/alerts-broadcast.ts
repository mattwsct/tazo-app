/**
 * Broadcast overlay data (settings + poll + alerts) to SSE clients
 * when alerts change. Gives overlays instant updates instead of
 * waiting for the 2s poll.
 */

import { kv } from '@/lib/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
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
    const [overlayAlerts, streamGoals] = await Promise.all([
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
      getStreamGoals(),
    ]);
    const combined = {
      ...merged,
      overlayAlerts,
      streamGoals,
    };
    await broadcastSettings(combined);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[alerts-broadcast] Failed to broadcast:', err);
    }
  }
}
