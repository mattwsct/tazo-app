import { kv } from '@/lib/kv';
import { addCredits } from '@/utils/gambling-storage';

const KICK_REWARD_PAYLOAD_LOG_KEY = 'kick_reward_payload_log';
const REWARD_PAYLOAD_LOG_MAX = 10;

export async function handleRewardRedemption(payload: Record<string, unknown>): Promise<{ chipRewardMessageSent: boolean }> {
  const reward = payload.reward as { title?: string; name?: string } | undefined;
  const rewardTitle = (reward?.title ?? reward?.name ?? '').trim();
  const rewardLog = {
    at: new Date().toISOString(),
    id: payload.id,
    status: String(payload.status ?? '').toLowerCase(),
    redeemer: (payload.redeemer as { username?: string })?.username,
    rewardTitle: rewardTitle || '?',
    userInput: (payload.user_input as string)?.slice(0, 100) ?? null,
  };

  try {
    await kv.lpush(KICK_REWARD_PAYLOAD_LOG_KEY, rewardLog);
    await kv.ltrim(KICK_REWARD_PAYLOAD_LOG_KEY, 0, REWARD_PAYLOAD_LOG_MAX - 1);
  } catch {
    /* ignore */
  }

  // Credits channel reward: if reward title matches and status is approved, grant credits.
  const status = String(payload.status ?? '').toLowerCase();
  const redeemer = (payload.redeemer as { username?: string })?.username ?? '';
  const redeemerUsername = redeemer.trim();

  if (redeemerUsername && (status === 'accepted' || status === 'approved' || status === 'completed' || status === 'fulfilled')) {
    const settings = (await kv.get<{ chipRewardTitle?: string; chipRewardChips?: number }>('overlay_settings')) ?? {};
    const matchTitle = (settings.chipRewardTitle ?? 'Buy Credits').trim().toLowerCase();
    const credits = Math.max(0, Math.floor(settings.chipRewardChips ?? 50));
    if (matchTitle && rewardTitle.toLowerCase() === matchTitle && credits > 0) {
      void addCredits(redeemerUsername, credits, { skipExclusions: true });
    }
  }

  return { chipRewardMessageSent: false };
}
