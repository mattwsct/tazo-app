/**
 * Kick webhook chat responses. Uses custom templates from KV when available.
 */

import type { KickMessageTemplates } from '@/types/kick-messages';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KickPayload = Record<string, any>;

function getUsername(obj: { username?: string | null } | null | undefined): string {
  return obj?.username ?? 'someone';
}

function replace(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? `{${key}}`);
}

export function getFollowResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const name = getUsername(payload.follower);
  return replace(templates.follow, { name });
}

export function getNewSubResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const name = getUsername(payload.subscriber);
  return replace(templates.newSub, { name });
}

export function getResubResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const name = getUsername(payload.subscriber);
  const months = String(payload.duration ?? 1);
  return replace(templates.resub, { name, months });
}

export function getGiftSubResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const gifter = payload.gifter;
  const gifterName = gifter?.is_anonymous ? 'Anonymous' : getUsername(gifter);
  const giftees = payload.giftees ?? [];
  const count = giftees.length;
  const names = giftees.map((g: { username?: string }) => g.username).filter(Boolean);
  if (count === 1 && names[0]) {
    return replace(templates.giftSubSingle, { gifter: gifterName, name: names[0] });
  }
  if (count > 1) {
    return replace(templates.giftSubMulti, { gifter: gifterName, count: String(count) });
  }
  return replace(templates.giftSubGeneric, { gifter: gifterName });
}

export function getKicksGiftedResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const sender = getUsername(payload.sender);
  const gift = payload.gift ?? {};
  const amount = String(gift.amount ?? 0);
  const name = gift.name ?? 'Kicks';
  const message = gift.message?.trim();
  if (message) {
    return replace(templates.kicksGiftedWithMessage, { sender, amount, name, message });
  }
  return replace(templates.kicksGifted, { sender, amount, name });
}

export function getChannelRewardResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const redeemer = getUsername(payload.redeemer);
  const reward = payload.reward ?? {};
  const title = reward.title ?? 'reward';
  const userInput = payload.user_input?.trim();
  const status = payload.status ?? 'accepted';
  if (status === 'rejected') {
    return replace(templates.channelRewardDeclined, { redeemer, title });
  }
  if (userInput) {
    return replace(templates.channelRewardWithInput, { redeemer, title, userInput });
  }
  return replace(templates.channelReward, { redeemer, title });
}
