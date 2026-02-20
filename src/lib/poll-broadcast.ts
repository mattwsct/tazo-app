/**
 * Broadcast overlay settings + poll state to SSE clients when poll state changes.
 * Gives overlays instant updates instead of waiting for the 15s polling interval.
 */

import { kv } from '@vercel/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { POLL_STATE_KEY } from '@/types/poll';
import type { PollState } from '@/types/poll';

export async function broadcastPollAndSettings(): Promise<void> {
  try {
    const [settings, rawPoll] = await kv.mget<[Record<string, unknown> | null, PollState | null]>(
      'overlay_settings',
      POLL_STATE_KEY
    );
    const merged = mergeSettingsWithDefaults({
      ...(settings && typeof settings === 'object' ? settings : {}),
      pollState: rawPoll ?? null,
    });
    await broadcastSettings(merged);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[poll-broadcast] Failed to broadcast:', err);
    }
  }
}
