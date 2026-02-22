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
import type { KickMessageTemplates, KickMessageTemplateEnabled } from '@/types/kick-messages';

export interface BuildEventMessageOptions {
  templates: KickMessageTemplates;
  templateEnabled?: KickMessageTemplateEnabled;
  minimumKicks: number;
}

export async function buildEventMessage(
  eventTypeNorm: string,
  payload: Record<string, unknown>,
  options: BuildEventMessageOptions
): Promise<string | null> {
  const { templates, templateEnabled, minimumKicks } = options;

  switch (eventTypeNorm) {
    case 'channel.followed':
      return getFollowResponse(payload, templates, templateEnabled);
    case 'channel.subscription.new':
      return getNewSubResponse(payload, templates, templateEnabled);
    case 'channel.subscription.renewal':
      return getResubResponse(payload, templates, templateEnabled);
    case 'channel.subscription.gifts':
      return getGiftSubResponse(payload, templates, templateEnabled);
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
