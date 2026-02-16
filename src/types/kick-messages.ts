export interface KickMessageTemplates {
  follow: string;
  newSub: string;
  resub: string;
  giftSubSingle: string;
  giftSubMulti: string;
  giftSubGeneric: string;
  kicksGifted: string;
  kicksGiftedWithMessage: string;
  channelReward: string;
  channelRewardWithInput: string;
  channelRewardDeclined: string;
}

export const DEFAULT_KICK_MESSAGES: KickMessageTemplates = {
  follow: 'New follow from {name}! 💚',
  newSub: 'New sub from {name}! 🎉',
  resub: '{name} resubbed! {months} months 💪',
  giftSubSingle: '{gifter} gifted a sub to {name}! 🎁',
  giftSubMulti: '{gifter} gifted {count} subs! 🎁',
  giftSubGeneric: '{gifter} gifted a sub! 🎁',
  kicksGifted: '{sender} sent {amount} {name}! 💰',
  kicksGiftedWithMessage: '{sender} sent {amount} {name}: "{message}" 💰',
  channelReward: '{redeemer} redeemed {title}! ✨',
  channelRewardWithInput: '{redeemer} redeemed {title}: "{userInput}" ✨',
  channelRewardDeclined: "{redeemer}'s {title} redemption was declined.",
};

export const KICK_MESSAGE_KEYS = [
  'follow',
  'newSub',
  'resub',
  'giftSubSingle',
  'giftSubMulti',
  'giftSubGeneric',
  'kicksGifted',
  'kicksGiftedWithMessage',
  'channelReward',
  'channelRewardWithInput',
  'channelRewardDeclined',
] as const satisfies readonly (keyof KickMessageTemplates)[];

/** Toggle keys: one per logical event type (Follow, New sub, Resub, Gift subs, Kicks gifted, Channel reward) */
export const KICK_EVENT_TOGGLE_KEYS = [
  'follow',
  'newSub',
  'resub',
  'giftSub',
  'kicksGifted',
  'channelReward',
] as const;

export type KickEventToggleKey = (typeof KICK_EVENT_TOGGLE_KEYS)[number];

export interface KickMessageEnabled {
  follow?: boolean;
  newSub?: boolean;
  resub?: boolean;
  giftSub?: boolean;
  kicksGifted?: boolean;
  channelReward?: boolean;
}

export const DEFAULT_KICK_MESSAGE_ENABLED: Required<KickMessageEnabled> = {
  follow: true,
  newSub: true,
  resub: true,
  giftSub: true,
  kicksGifted: true,
  channelReward: true,
};

/** Maps webhook event type to toggle key */
export const EVENT_TYPE_TO_TOGGLE: Record<string, KickEventToggleKey> = {
  'channel.followed': 'follow',
  'channel.subscription.new': 'newSub',
  'channel.subscription.renewal': 'resub',
  'channel.subscription.gifts': 'giftSub',
  'kicks.gifted': 'kicksGifted',
  'channel.reward.redemption.updated': 'channelReward',
};
