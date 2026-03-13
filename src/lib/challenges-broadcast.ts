/**
 * Instantly push challenges + wallet state to all connected SSE overlay clients.
 * Call this after any challenge or wallet change so the overlay updates immediately
 * instead of waiting for the 15s SSE fallback poll.
 */

import { kv } from '@/lib/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { getStreamGoals } from '@/utils/stream-goals-storage';
import { getOverlayTimer } from '@/utils/overlay-timer-storage';
import { getChallenges, getWallet } from '@/utils/challenges-storage';
import { POLL_STATE_KEY } from '@/types/poll';
import type { PollState } from '@/types/poll';
import { TRIVIA_STATE_KEY } from '@/types/trivia';
import type { TriviaState } from '@/types/trivia';

export async function broadcastChallenges(): Promise<void> {
  try {
    const [settings, rawPoll, triviaState] = await kv.mget<[Record<string, unknown> | null, PollState | null, TriviaState | null]>(
      'overlay_settings',
      POLL_STATE_KEY,
      TRIVIA_STATE_KEY,
    );
    const merged = mergeSettingsWithDefaults({
      ...(settings && typeof settings === 'object' ? settings : {}),
      pollState: rawPoll ?? null,
    });
    const [overlayAlerts, streamGoals, timerState, challengesState, walletState] = await Promise.all([
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
      getStreamGoals(),
      getOverlayTimer(),
      getChallenges(),
      getWallet(),
    ]);
    const combined = {
      ...merged,
      overlayAlerts,
      streamGoals,
      timerState: timerState ?? null,
      triviaState: triviaState ?? null,
      challengesState,
      walletState,
    };
    await broadcastSettings(combined);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[challenges-broadcast] Failed:', err);
    }
  }
}
