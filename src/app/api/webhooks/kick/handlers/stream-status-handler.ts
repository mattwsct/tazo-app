import { markStreamLiveFromWebhook } from '@/utils/stats-storage';
import { clearBlackjackStateOnStreamStart, isGamblingEnabled } from '@/utils/gambling-storage';
import { resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals, resetStreamTitleToLocationOnly } from '@/lib/stream-title-updater';
import { setChannelCategoryToIRL } from '@/lib/category-chat-handler';

export async function handleStreamStatus(payload: Record<string, unknown>, eventNorm: string): Promise<void> {
  if (eventNorm !== 'livestream.status.updated') return;

  if (payload.is_live === true) {
    const now = Date.now();
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
        const { subTarget: initialSubTarget } = await resetStreamGoalsOnStreamStart();
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
