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
  streamStarted: string;
  streamEnded: string;
}

export const DEFAULT_KICK_MESSAGES: KickMessageTemplates = {
  follow: 'New follow from {name}! 💚',
  newSub: 'New sub from {name}! 🎉',
  resub: '{name} resubbed! {months} months 💪',
  giftSubSingle: '{gifter} gifted a sub to {name}!{lifetimeSubs} 🎁',
  giftSubMulti: '{gifter} gifted {count} subs!{lifetimeSubs} 🎁',
  giftSubGeneric: '{gifter} gifted a sub!{lifetimeSubs} 🎁',
  kicksGifted: '{sender} sent {amount} {name}! 💰',
  kicksGiftedWithMessage: '{sender} sent {amount} {name}: "{message}" 💰',
  channelReward: '{redeemer} redeemed {title}! ✨',
  channelRewardWithInput: '{redeemer} redeemed {title}: "{userInput}" ✨',
  channelRewardDeclined: "{redeemer}'s {title} redemption was declined.",
  streamStarted: "We're live! 🎬",
  streamEnded: 'Thanks for watching! Stream ended. 🙏',
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
  'streamStarted',
  'streamEnded',
] as const satisfies readonly (keyof KickMessageTemplates)[];

/** Toggle keys: one per logical event type */
export const KICK_EVENT_TOGGLE_KEYS = [
  'follow',
  'newSub',
  'resub',
  'giftSub',
  'kicksGifted',
  'channelReward',
  'streamStatus',
] as const;

export type KickEventToggleKey = (typeof KICK_EVENT_TOGGLE_KEYS)[number];

export interface KickMessageEnabled {
  follow?: boolean;
  newSub?: boolean;
  resub?: boolean;
  giftSub?: boolean;
  kicksGifted?: boolean;
  channelReward?: boolean;
  streamStatus?: boolean;
}

export const DEFAULT_KICK_MESSAGE_ENABLED: Required<KickMessageEnabled> = {
  follow: true,
  newSub: true,
  resub: true,
  giftSub: true,
  kicksGifted: true,
  channelReward: true,
  streamStatus: true,
};

/** Icons for each template group */
export const TEMPLATE_GROUP_ICONS: Record<KickEventToggleKey, string> = {
  follow: '💚',
  newSub: '🎉',
  resub: '💪',
  giftSub: '🎁',
  kicksGifted: '💰',
  channelReward: '✨',
  streamStatus: '🎬',
};

/** Groups templates by toggle, for inline toggle+template UI */
export const TEMPLATE_GROUP_CONFIG: { toggleKey: KickEventToggleKey; label: string; templateKeys: (keyof KickMessageTemplates)[] }[] = [
  { toggleKey: 'follow', label: 'Follow', templateKeys: ['follow'] },
  { toggleKey: 'newSub', label: 'New sub', templateKeys: ['newSub'] },
  { toggleKey: 'resub', label: 'Resub', templateKeys: ['resub'] },
  { toggleKey: 'giftSub', label: 'Gift subs', templateKeys: ['giftSubSingle', 'giftSubMulti', 'giftSubGeneric'] },
  { toggleKey: 'kicksGifted', label: 'Kicks gifted', templateKeys: ['kicksGifted', 'kicksGiftedWithMessage'] },
  { toggleKey: 'channelReward', label: 'Channel reward', templateKeys: ['channelReward', 'channelRewardWithInput', 'channelRewardDeclined'] },
  { toggleKey: 'streamStatus', label: 'Stream started/ended', templateKeys: ['streamStarted', 'streamEnded'] },
];

/** Maps webhook event type to toggle key */
export const EVENT_TYPE_TO_TOGGLE: Record<string, KickEventToggleKey> = {
  'channel.followed': 'follow',
  'channel.subscription.new': 'newSub',
  'channel.subscription.renewal': 'resub',
  'channel.subscription.gifts': 'giftSub',
  'kicks.gifted': 'kicksGifted',
  'channel.reward.redemption.updated': 'channelReward',
  'livestream.status.updated': 'streamStatus',
};
