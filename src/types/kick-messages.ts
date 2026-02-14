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
