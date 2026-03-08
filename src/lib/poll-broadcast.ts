import { kv } from '@/lib/kv';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { POLL_STATE_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY } from '@/types/trivia';
import type { PollState } from '@/types/poll';
import type { TriviaState } from '@/types/trivia';

export async function broadcastPollAndSettings(): Promise<void> {
  try {
    const [settings, rawPoll, rawTrivia] = await kv.mget<
      [Record<string, unknown> | null, PollState | null, TriviaState | null]
    >('overlay_settings', POLL_STATE_KEY, TRIVIA_STATE_KEY);
    const merged = mergeSettingsWithDefaults({
      ...(settings && typeof settings === 'object' ? settings : {}),
      pollState: rawPoll ?? null,
      triviaState: rawTrivia ?? null,
    });
    await broadcastSettings(merged);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[poll-broadcast] Failed to broadcast:', err);
    }
  }
}
