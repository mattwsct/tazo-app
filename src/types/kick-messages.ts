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
  host: string;
}

export const DEFAULT_KICK_MESSAGES: KickMessageTemplates = {
  follow: 'New follow from {name}! 💚',
  newSub: 'New sub from {name}! 🎉',
  resub: '{name} resubbed! {months} months 💪',
  giftSubSingle: '{gifter} gifted a sub to {name}! 🎁 {lifetimeSubs}',
  giftSubMulti: '{gifter} gifted {count} subs! 🎁 {lifetimeSubs}',
  giftSubGeneric: '{gifter} gifted a sub! 🎁 {lifetimeSubs}',
  kicksGifted: '{sender} sent {kickDescription}! 💰',
  kicksGiftedWithMessage: '{sender} sent {kickDescription}: "{message}" 💰',
  channelReward: '{redeemer} redeemed {title}! ✨',
  channelRewardWithInput: '{redeemer} redeemed {title}: "{userInput}" ✨',
  channelRewardDeclined: "{redeemer}'s {title} redemption was declined.",
  streamStarted: "We're live! 🎬",
  streamEnded: 'Thanks for watching! Stream ended. 🙏',
  host: '{host} hosted with {viewers} viewers! 🎉',
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
  'host',
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
  'host',
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
  host?: boolean;
}

export const DEFAULT_KICK_MESSAGE_ENABLED: Required<KickMessageEnabled> = {
  follow: true,
  newSub: true,
  resub: true,
  giftSub: true,
  kicksGifted: true,
  channelReward: true,
  streamStatus: true,
  host: true,
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
  host: '📺',
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
  { toggleKey: 'host', label: 'Host', templateKeys: ['host'] },
];

export const KICK_MESSAGES_KEY = 'kick_message_templates';
export const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';
export const KICK_ALERT_SETTINGS_KEY = 'kick_alert_settings';

/** Maps webhook event type to toggle key */
export const EVENT_TYPE_TO_TOGGLE: Record<string, KickEventToggleKey> = {
  'channel.followed': 'follow',
  'channel.subscription.new': 'newSub',
  'channel.subscription.renewal': 'resub',
  'channel.subscription.gifts': 'giftSub',
  'kicks.gifted': 'kicksGifted',
  'channel.reward.redemption.updated': 'channelReward',
  'livestream.status.updated': 'streamStatus',
  'channel.hosted': 'host',
};

/** Check if an event type is disabled by its toggle. */
export function isToggleDisabled(
  toggleKey: KickEventToggleKey | undefined,
  toggleValue: boolean | undefined
): boolean {
  if (!toggleKey) return false;
  return (
    toggleValue === false ||
    (toggleValue as unknown) === 0 ||
    String(toggleValue).toLowerCase() === 'false'
  );
}
