import { kv } from '@/lib/kv';
import { addCredits } from '@/utils/gambling-storage';
import { pushSubAlert, pushResubAlert, pushGiftSubAlert, pushKicksAlert } from '@/utils/overlay-alerts-storage';
import { addStreamGoalSubs, addStreamGoalKicks, getStreamGoals } from '@/utils/stream-goals-storage';
import { bumpGoalTarget } from '@/utils/stream-goals-celebration';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';

const getUsername = (obj: unknown) => ((obj as { username?: string })?.username ?? '').trim();

// Settings are fetched once per event and passed in to avoid a duplicate KV read.
const handleSubGoalMilestone = async (count: number, settings: Record<string, unknown> | null) => {
  const goals = await getStreamGoals();
  const target = (settings?.subGoalTarget as number) ?? 5;
  const increment = (settings?.subGoalIncrement as number) ?? 5;
  const kicksTarget = (settings?.kicksGoalTarget as number) ?? 5000;
  const hasSubtext = !!(settings?.subGoalSubtext as string | null | undefined);
  const showSubGoal = !!(settings?.showSubGoal);
  const prevSubs = goals.subs - count;
  if (showSubGoal && target > 0 && prevSubs < target && goals.subs >= target) {
    const newTarget = hasSubtext ? target : await bumpGoalTarget('subs', target, increment, goals.subs);
    const token = await getValidAccessToken();
    if (token) {
      try {
        await sendKickChatMessage(token, `🎉 Sub goal reached! ${goals.subs}/${target} subs this stream!`);
      } catch (err) {
        console.error('[Webhook] Sub milestone chat failed:', err instanceof Error ? err.message : String(err));
      }
      void updateKickTitleGoals(goals.subs, newTarget, goals.kicks, kicksTarget).catch(() => {});
    } else {
      console.warn('[Webhook] Sub milestone: no access token, chat message skipped');
    }
  } else {
    void updateKickTitleGoals(goals.subs, target, goals.kicks, kicksTarget).catch(() => {});
  }
};

export async function handleAlertEvents(
  eventNorm: string,
  payload: Record<string, unknown>
): Promise<{ didAlertOrLeaderboard: boolean }> {
  let didAlertOrLeaderboard = false;

  if (eventNorm === 'channel.followed') {
    const follower = getUsername(payload.follower);
    if (follower) didAlertOrLeaderboard = true;
  } else if (eventNorm === 'channel.subscription.new') {
    const subscriber = payload.subscriber;
    if (subscriber) {
      const username = getUsername(subscriber);
      if (username) void addCredits(username, 100);
      // Fetch settings concurrently with the increment — settings don't change during INCRBY.
      const [, , settings] = await Promise.all([
        addStreamGoalSubs(1),
        pushSubAlert(subscriber),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      didAlertOrLeaderboard = true;
      await handleSubGoalMilestone(1, settings);
    }
  } else if (eventNorm === 'channel.subscription.renewal') {
    const subscriber = payload.subscriber;
    const duration = (payload.duration as number) ?? 0;
    if (subscriber) {
      const username = getUsername(subscriber);
      if (username) void addCredits(username, 100);
      const [, , settings] = await Promise.all([
        addStreamGoalSubs(1),
        pushResubAlert(subscriber, duration > 0 ? duration : undefined),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      didAlertOrLeaderboard = true;
      await handleSubGoalMilestone(1, settings);
    }
  } else if (eventNorm === 'channel.subscription.gifts') {
    const gifter = payload.gifter ?? (payload.data as Record<string, unknown>)?.gifter;
    const giftees = (payload.giftees as unknown[]) ?? [];
    const count = giftees.length > 0 ? giftees.length : 1;
    if (gifter) {
      const gifterUsername = getUsername(gifter);
      if (gifterUsername) void addCredits(gifterUsername, 100);
      const [, , settings] = await Promise.all([
        addStreamGoalSubs(count),
        pushGiftSubAlert(gifter, count),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      didAlertOrLeaderboard = true;
      await handleSubGoalMilestone(count, settings);
    }
  } else if (eventNorm === 'kicks.gifted') {
    const sender = payload.sender;
    const gift = payload.gift as { amount?: number; name?: string } | undefined;
    const amount = Number(gift?.amount ?? 0);
    const giftName = gift?.name as string | undefined;
    if (sender && amount > 0) {
      const senderUsername = getUsername(sender);
      if (senderUsername) void addCredits(senderUsername, amount);
      // Fetch settings concurrently with the increment — settings don't change during INCRBY.
      // Goals must be read after the increment to get the updated total.
      const [, , settings] = await Promise.all([
        addStreamGoalKicks(amount),
        pushKicksAlert(sender, amount, giftName),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      didAlertOrLeaderboard = true;
      const goals = await getStreamGoals();
      const target = (settings?.kicksGoalTarget as number) ?? 5000;
      const increment = (settings?.kicksGoalIncrement as number) ?? 5000;
      const hasKicksSubtext = !!(settings?.kicksGoalSubtext as string | null | undefined);
      const prevKicks = goals.kicks - amount;
      const showKicksGoal = !!(settings?.showKicksGoal);
      if (showKicksGoal && target > 0 && prevKicks < target && goals.kicks >= target) {
        if (!hasKicksSubtext) await bumpGoalTarget('kicks', target, increment, goals.kicks);
        const token = await getValidAccessToken();
        if (token) {
          try {
            await sendKickChatMessage(token, `🎉 Kicks goal reached! ${goals.kicks}/${target} kicks this stream!`);
          } catch (err) {
            console.error('[Webhook] Kicks milestone chat failed:', err instanceof Error ? err.message : String(err));
          }
        } else {
          console.warn('[Webhook] Kicks milestone: no access token, chat message skipped');
        }
      }
    }
  }

  return { didAlertOrLeaderboard };
}
