/**
 * Kick webhook chat responses. Uses custom templates from KV when available.
 * Respects per-template toggles (templateEnabled) - returns null when template is disabled.
 */

import type { KickMessageTemplates, KickMessageTemplateEnabled } from '@/types/kick-messages';
import { isTemplateDisabled } from '@/types/kick-messages';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KickPayload = Record<string, any>;

function getUsername(obj: { username?: string | null } | null | undefined): string {
  return obj?.username ?? 'someone';
}

const OPTIONAL_PLACEHOLDERS = new Set(['lifetimeSubs']);
const REWARD_STATUS_DECLINED = new Set(['rejected', 'denied', 'canceled']);
const REWARD_STATUS_APPROVED = new Set(['accepted', 'fulfilled', 'approved']);

/** Resolve which template key was used for a reward status (for logging) */
export function getRewardTemplateKey(status: string, alreadySeen: boolean): string {
  if (alreadySeen) return 'channelRewardApproved (id seen, dedup)';
  if (REWARD_STATUS_APPROVED.has(status)) return 'channelRewardApproved';
  if (REWARD_STATUS_DECLINED.has(status)) return 'channelRewardDeclined';
  return status ? `channelReward/WithInput (status=${status})` : 'channelReward/WithInput (status missing)';
}

function replace(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = replacements[key];
    if (val !== undefined && val !== null) return String(val);
    if (OPTIONAL_PLACEHOLDERS.has(key)) return '';
    return `{${key}}`;
  });
}

export function getFollowResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  if (isTemplateDisabled(templateEnabled, 'follow')) return null;
  const name = getUsername(payload.follower);
  return replace(templates.follow, { name });
}

export function getNewSubResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  if (isTemplateDisabled(templateEnabled, 'newSub')) return null;
  const name = getUsername(payload.subscriber);
  return replace(templates.newSub, { name });
}

export function getResubResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  if (isTemplateDisabled(templateEnabled, 'resub')) return null;
  const name = getUsername(payload.subscriber);
  const months = String(payload.duration ?? 1);
  return replace(templates.resub, { name, months });
}

export function getGiftSubResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  extraReplacements?: Record<string, string>,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  const gifter = payload.gifter;
  const gifterName = gifter?.is_anonymous ? 'Anonymous' : getUsername(gifter);
  const giftees = payload.giftees ?? [];
  const count = giftees.length;
  const names = giftees.map((g: { username?: string }) => g.username).filter(Boolean);
  const base: Record<string, string> = { gifter: gifterName, lifetimeSubs: '' };
  if (extraReplacements) Object.assign(base, extraReplacements);
  if (count === 1 && names[0]) {
    if (isTemplateDisabled(templateEnabled, 'giftSubSingle')) return null;
    return replace(templates.giftSubSingle, { ...base, name: names[0] });
  }
  if (count > 1) {
    if (isTemplateDisabled(templateEnabled, 'giftSubMulti')) return null;
    return replace(templates.giftSubMulti, { ...base, count: String(count) });
  }
  if (isTemplateDisabled(templateEnabled, 'giftSubGeneric')) return null;
  return replace(templates.giftSubGeneric, base);
}

export function getKicksGiftedResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
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
    if (isTemplateDisabled(templateEnabled, 'kicksGiftedWithMessage')) return null;
    return replace(templates.kicksGiftedWithMessage, { ...replacements, message });
  }
  if (isTemplateDisabled(templateEnabled, 'kicksGifted')) return null;
  return replace(templates.kicksGifted, replacements);
}

export interface GetChannelRewardOptions {
  /** Force approved template (for deduplication: second webhook = approval) */
  forceApproved?: boolean;
}

/** Extract reward payload; Kick may send top-level or wrapped in data/payload/event. Exported for webhook route. */
export function getRewardInnerPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const d = payload.data as Record<string, unknown> | undefined;
  const p = payload.payload as Record<string, unknown> | undefined;
  const ev = payload.event as Record<string, unknown> | undefined;
  const evData = ev?.data as Record<string, unknown> | undefined;
  return (d ?? p ?? evData ?? payload) as Record<string, unknown>;
}

export function getChannelRewardResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  options?: GetChannelRewardOptions,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  const inner = getRewardInnerPayload(payload as Record<string, unknown>);
  const redeemer = getUsername((inner.redeemer ?? payload.redeemer) as { username?: string });
  const reward = (inner.reward ?? payload.reward ?? {}) as Record<string, unknown>;
  const title = String(reward.title ?? reward.name ?? 'reward');
  const userInput = (inner.user_input ?? payload.user_input)?.toString?.()?.trim?.();
  if (options?.forceApproved) {
    if (isTemplateDisabled(templateEnabled, 'channelRewardApproved')) return null;
    return replace(templates.channelRewardApproved, { redeemer, title });
  }
  const status = String(
    inner.status ?? payload.status ?? (reward as { status?: string }).status ?? 'pending'
  ).toLowerCase();
  if (REWARD_STATUS_DECLINED.has(status)) {
    if (isTemplateDisabled(templateEnabled, 'channelRewardDeclined')) return null;
    return replace(templates.channelRewardDeclined, { redeemer, title });
  }
  if (REWARD_STATUS_APPROVED.has(status)) {
    if (isTemplateDisabled(templateEnabled, 'channelRewardApproved')) return null;
    return replace(templates.channelRewardApproved, { redeemer, title });
  }
  if (userInput) {
    if (isTemplateDisabled(templateEnabled, 'channelRewardWithInput')) return null;
    return replace(templates.channelRewardWithInput, { redeemer, title, userInput });
  }
  if (isTemplateDisabled(templateEnabled, 'channelReward')) return null;
  return replace(templates.channelReward, { redeemer, title });
}

/** Payload: channel.hosted - host hosted the channel with viewers */
export function getHostResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  if (isTemplateDisabled(templateEnabled, 'host')) return null;
  const host = getUsername(payload.host ?? payload.hoster);
  const viewers = String(payload.viewers ?? payload.viewer_count ?? 0);
  return replace(templates.host, { host, viewers });
}

/** Payload: livestream.status.updated - is_live: true when started, false when ended */
export function getStreamStatusResponse(
  payload: KickPayload,
  templates: KickMessageTemplates,
  templateEnabled?: KickMessageTemplateEnabled
): string | null {
  const isLive = payload.is_live === true;
  const key = isLive ? 'streamStarted' : 'streamEnded';
  if (isTemplateDisabled(templateEnabled, key)) return null;
  const template = isLive ? templates.streamStarted : templates.streamEnded;
  return template;
}
