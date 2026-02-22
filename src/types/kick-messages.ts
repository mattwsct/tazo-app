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
  channelRewardApproved: string;
  channelRewardDeclined: string;
  streamStarted: string;
  streamEnded: string;
}

export const DEFAULT_KICK_MESSAGES: KickMessageTemplates = {
  follow: '{name} followed! 💚',
  newSub: '{name} just subscribed! 🎉',
  resub: '{name} resubbed! {months} months 💪',
  giftSubSingle: '{gifter} gifted a sub to {name}! 🎁',
  giftSubMulti: '{gifter} gifted {count} subs! 🎁',
  giftSubGeneric: '{gifter} gifted a sub! 🎁',
  kicksGifted: '{sender} sent {kickDescription}! 💰',
  kicksGiftedWithMessage: '{sender} sent {kickDescription}: "{message}" 💰',
  channelReward: '{redeemer} redeemed {title}! ✨',
  channelRewardWithInput: '{redeemer} redeemed {title}: "{userInput}" ✨',
  channelRewardApproved: "{redeemer}'s {title} was approved! ✓",
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
  'channelRewardApproved',
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
  { toggleKey: 'channelReward', label: 'Channel reward', templateKeys: ['channelReward', 'channelRewardWithInput', 'channelRewardApproved', 'channelRewardDeclined'] },
  { toggleKey: 'streamStatus', label: 'Stream started/ended', templateKeys: ['streamStarted', 'streamEnded'] },
];

export const KICK_MESSAGES_KEY = 'kick_message_templates';
export const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';
export const KICK_MESSAGE_TEMPLATE_ENABLED_KEY = 'kick_message_template_enabled';
export const KICK_MESSAGE_TEMPLATES_BACKUP_KEY = 'kick_message_templates_backup';
export const KICK_ALERT_SETTINGS_KEY = 'kick_alert_settings';

/** Per-template toggles: each message type has its own on/off. Default all true. */
export type KickMessageTemplateEnabled = Partial<Record<keyof KickMessageTemplates, boolean>>;

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

/** Check if a specific template is disabled by its per-template toggle. */
export function isTemplateDisabled(
  templateEnabled: KickMessageTemplateEnabled | undefined,
  templateKey: keyof KickMessageTemplates
): boolean {
  if (!templateEnabled) return false;
  return templateEnabled[templateKey] === false;
}

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
