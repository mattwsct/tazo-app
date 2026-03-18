import { markStreamLiveFromWebhook, isStreamLive } from '@/utils/stats-storage';
import { clearBlackjackStateOnStreamStart, isGamblingEnabled } from '@/utils/gambling-storage';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals, resetStreamTitleToLocationOnly } from '@/lib/stream-title-updater';
import { setChannelCategoryToIRL } from '@/lib/category-chat-handler';
import { resetWallet, resetChallenges } from '@/utils/challenges-storage';
import { setOverlayTimer } from '@/utils/overlay-timer-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { POLL_STATE_KEY, POLL_QUEUE_KEY, LAST_POLL_ENDED_AT_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY } from '@/types/trivia';
import { kv } from '@/lib/kv';

const OVERLAY_ALERTS_KEY = 'kick_overlay_alerts';
const OVERLAY_TIMER_ANNOUNCED_KEY = 'overlay_timer_announced_ends_at';

export async function handleStreamStatus(payload: Record<string, unknown>, eventNorm: string): Promise<void> {
  if (eventNorm !== 'livestream.status.updated') return;

  if (payload.is_live === true) {
    const now = Date.now();

    // Guard against reconnects: if already live, this is a mid-stream drop/reconnect — skip reset.
    const alreadyLive = await isStreamLive();
    if (alreadyLive) {
      void markStreamLiveFromWebhook(true, now);
      return;
    }

    void markStreamLiveFromWebhook(true, now);

    void (async () => {
      const { clearWellnessSnapshotAtStreamEnd } = await import('@/utils/wellness-storage');
      await clearWellnessSnapshotAtStreamEnd();
    })();
    void (async () => {
      if (await isGamblingEnabled()) void clearBlackjackStateOnStreamStart();
    })();
    void (async () => {
      try {
        const settings = await kv.get<Record<string, unknown>>('overlay_settings');
        const startingBalance = (settings?.walletStartingBalance as number) ?? 15;
        const startShowWallet = (settings?.startShowWallet as boolean) ?? false;
        const startShowSpent = (settings?.startShowSpent as boolean) ?? true;

        // Apply start-of-stream visibility preferences
        await kv.set('overlay_settings', { ...(settings ?? {}), walletEnabled: startShowWallet, showSpentOverlay: startShowSpent });

        const [{ subTarget: initialSubTarget }] = await Promise.all([
          resetStreamGoalsOnStreamStart(),
          resetWallet(startingBalance),
          resetChallenges(),
          setOverlayTimer(null),
          kv.del(POLL_STATE_KEY),
          kv.del(POLL_QUEUE_KEY),
          kv.del(LAST_POLL_ENDED_AT_KEY),
          kv.del(TRIVIA_STATE_KEY),
          kv.del(OVERLAY_ALERTS_KEY),
          kv.del(OVERLAY_TIMER_ANNOUNCED_KEY),
        ]);

        void broadcastChallenges().catch(() => {});
        void updateKickTitleGoals(0, initialSubTarget).catch((e) => {
          console.warn('[stream-status] Failed to update kick title goals on stream start:', e);
        });
      } catch (e) {
        console.warn('Failed to reset stream session on stream start:', e);
      }
    })();
  }

  if (payload.is_live === false) {
    const now = Date.now();
    void markStreamLiveFromWebhook(false, now);
    void resetStreamTitleToLocationOnly();
    void setChannelCategoryToIRL();
    void resetStreamGoalsOnStreamStart();
    void (async () => {
      try {
        const { setWellnessSnapshotAtStreamEnd } = await import('@/utils/wellness-storage');
        await setWellnessSnapshotAtStreamEnd();
      } catch (e) {
        console.warn('Failed to set wellness snapshot at stream end:', e);
      }
    })();
  }
}
