/**
 * Kick webhook chat responses. Uses custom templates from KV when available.
 */

import type { KickMessageTemplates } from '@/types/kick-messages';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KickPayload = Record<string, any>;

function getUsername(obj: { username?: string | null } | null | undefined): string {
  return obj?.username ?? 'someone';
}

const OPTIONAL_PLACEHOLDERS = new Set(['lifetimeSubs']);

function replace(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = replacements[key];
    if (val !== undefined && val !== null) return String(val);
    if (OPTIONAL_PLACEHOLDERS.has(key)) return '';
    return `{${key}}`;
  });
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

export function getGiftSubResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  extraReplacements?: Record<string, string>
): string {
  const gifter = payload.gifter;
  const gifterName = gifter?.is_anonymous ? 'Anonymous' : getUsername(gifter);
  const giftees = payload.giftees ?? [];
  const count = giftees.length;
  const names = giftees.map((g: { username?: string }) => g.username).filter(Boolean);
  const base: Record<string, string> = { gifter: gifterName, lifetimeSubs: '' };
  if (extraReplacements) Object.assign(base, extraReplacements);
  if (count === 1 && names[0]) {
    return replace(templates.giftSubSingle, { ...base, name: names[0] });
  }
  if (count > 1) {
    return replace(templates.giftSubMulti, { ...base, count: String(count) });
  }
  return replace(templates.giftSubGeneric, base);
}

export function getKicksGiftedResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const sender = getUsername(payload.sender);
  const gift = payload.gift ?? payload.data?.gift ?? {};
  const amount = String(gift.amount ?? gift.amount_display ?? 0);
  const rawName = gift.name ?? gift.display_name ?? 'Kicks';
  const message = (gift.message ?? '').toString().trim();
  const kickDescription =
    rawName && rawName !== 'Kicks'
      ? `${rawName} (${amount} kicks)`
      : `${amount} kicks`;
  const replacements: Record<string, string> = {
    sender,
    amount,
    name: rawName,
    kickDescription,
  };
  if (message) {
    return replace(templates.kicksGiftedWithMessage, { ...replacements, message });
  }
  return replace(templates.kicksGifted, replacements);
}

export interface GetChannelRewardOptions {
  /** Force approved template (for deduplication: second webhook = approval) */
  forceApproved?: boolean;
}

export function getChannelRewardResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  options?: GetChannelRewardOptions
): string {
  const data = payload.data as Record<string, unknown> | undefined;
  const inner = data ?? payload;
  const redeemer = getUsername((inner.redeemer ?? payload.redeemer) as { username?: string });
  const reward = (inner.reward ?? payload.reward ?? {}) as Record<string, unknown>;
  const title = String(reward.title ?? reward.name ?? 'reward');
  const userInput = (inner.user_input ?? payload.user_input)?.toString?.()?.trim?.();
  if (options?.forceApproved) {
    return replace(templates.channelRewardApproved, { redeemer, title });
  }
  const status = String(
    inner.status ?? payload.status ?? (reward as { status?: string }).status ?? 'pending'
  ).toLowerCase();
  if (status === 'rejected' || status === 'denied' || status === 'canceled') {
    return replace(templates.channelRewardDeclined, { redeemer, title });
  }
  if (status === 'accepted' || status === 'fulfilled' || status === 'approved') {
    return replace(templates.channelRewardApproved, { redeemer, title });
  }
  if (userInput) {
    return replace(templates.channelRewardWithInput, { redeemer, title, userInput });
  }
  return replace(templates.channelReward, { redeemer, title });
}

/** Payload: channel.hosted - host hosted the channel with viewers */
export function getHostResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const host = getUsername(payload.host ?? payload.hoster);
  const viewers = String(payload.viewers ?? payload.viewer_count ?? 0);
  return replace(templates.host, { host, viewers });
}

/** Payload: livestream.status.updated - is_live: true when started, false when ended */
export function getStreamStatusResponse(payload: KickPayload, templates: KickMessageTemplates): string {
  const isLive = payload.is_live === true;
  const template = isLive ? templates.streamStarted : templates.streamEnded;
  return template;
}
