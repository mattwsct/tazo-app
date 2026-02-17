/**
 * Shared Kick webhook event handling. Builds chat messages from event payloads.
 */

import {
  getFollowResponse,
  getNewSubResponse,
  getResubResponse,
  getGiftSubResponse,
  getKicksGiftedResponse,
  getChannelRewardResponse,
  getStreamStatusResponse,
} from '@/lib/kick-event-responses';
import { getKickSubscriptionLeaderboard } from '@/lib/kick-api';
import type { KickMessageTemplates, KickMessageTemplateEnabled } from '@/types/kick-messages';

export interface BuildEventMessageOptions {
  templates: KickMessageTemplates;
  templateEnabled?: KickMessageTemplateEnabled;
  minimumKicks: number;
  giftSubShowLifetimeSubs: boolean;
  getAccessToken: () => Promise<string | null>;
}

export async function buildEventMessage(
  eventTypeNorm: string,
  payload: Record<string, unknown>,
  options: BuildEventMessageOptions
): Promise<string | null> {
  const { templates, templateEnabled, minimumKicks, giftSubShowLifetimeSubs, getAccessToken } = options;

  switch (eventTypeNorm) {
    case 'channel.followed':
      return getFollowResponse(payload, templates, templateEnabled);
    case 'channel.subscription.new':
      return getNewSubResponse(payload, templates, templateEnabled);
    case 'channel.subscription.renewal':
      return getResubResponse(payload, templates, templateEnabled);
    case 'channel.subscription.gifts': {
      let lifetimeSubs = '';
      if (giftSubShowLifetimeSubs) {
        const token = await getAccessToken();
        if (token) {
          try {
            const leaderboard = await getKickSubscriptionLeaderboard(token);
            const raw = payload as { gifter?: { username?: string; is_anonymous?: boolean }; data?: { gifter?: { username?: string; is_anonymous?: boolean } } };
            const gifter = raw.gifter ?? raw.data?.gifter;
            if (gifter && !gifter.is_anonymous && gifter.username) {
              const total = leaderboard.get(gifter.username.toLowerCase());
              if (total != null && total > 0) lifetimeSubs = `(${total} lifetime)`;
            }
          } catch {
            // Leaderboard fetch failed - continue without
          }
        }
      }
      return getGiftSubResponse(payload, templates, { lifetimeSubs }, templateEnabled);
    }
    case 'kicks.gifted': {
      const amount = Number((payload.gift as { amount?: number })?.amount ?? 0);
      if (amount < minimumKicks) return null;
      return getKicksGiftedResponse(payload, templates, templateEnabled);
    }
    case 'channel.reward.redemption.updated':
      return getChannelRewardResponse(payload, templates, undefined, templateEnabled);
    case 'livestream.status.updated':
      return getStreamStatusResponse(payload, templates, templateEnabled);
    default:
      return null;
  }
}
