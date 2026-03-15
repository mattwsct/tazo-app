export interface LinkItem {
  id: string;
  url: string;
  title: string;
  button: string;
  description: string;
  icon: string | null;
  showOnHomepage: boolean;
  featured: boolean;
  category: 'streaming' | 'social' | 'support' | 'other';
  bg: string;        // kept for legacy / manual overrides; prefer getBrandBg()
  aliases?: string[];
}

/** Brand gradient per simpleicons slug. Used as the button background. */
export const PLATFORM_BRAND_BG: Record<string, string> = {
  kick:        'from-[#53fc18] to-[#2f8f0b]',
  twitch:      'from-[#9146FF] to-[#6441A5]',
  youtube:     'from-[#FF0000] to-[#991b1b]',
  tiktok:      'from-[#25F4EE] to-[#FE2C55]',
  instagram:   'from-[#f09433] via-[#e6683c] to-[#dc2743]',
  x:           'from-[#000000] to-[#27272a]',
  discord:     'from-[#5865F2] to-[#404EED]',
  facebook:    'from-[#1877F2] to-[#0C4A9E]',
  onlyfans:    'from-[#00AFF0] to-[#005C80]',
  kofi:        'from-[#FF5E5B] to-[#FF8FA3]',
  paypal:      'from-[#003087] to-[#009CDE]',
  patreon:     'from-[#F96854] to-[#e44a3b]',
  rumble:      'from-[#85C742] to-[#4CAF50]',
  spotify:     'from-[#1DB954] to-[#158a3e]',
  snapchat:    'from-[#FFFC00] to-[#F7C948]',
  reddit:      'from-[#FF4500] to-[#cc3700]',
  linkedin:    'from-[#0077B5] to-[#005582]',
  github:      'from-[#24292e] to-[#1a1f24]',
  steam:       'from-[#1b2838] to-[#2a475e]',
  twitch2:     'from-[#9146FF] to-[#6441A5]',
  kit:         'from-zinc-600 to-zinc-800',
};

export const DEFAULT_LINK_BG = 'from-zinc-600 to-zinc-800';

/** Returns the brand gradient for a known icon slug, or the default. */
export function getBrandBg(icon: string | null | undefined): string {
  return (icon && PLATFORM_BRAND_BG[icon]) ?? DEFAULT_LINK_BG;
}

export const LINKS: LinkItem[] = [
  {
    id: 'kick',
    url: 'https://kick.com/tazo',
    title: 'Tazo on Kick',
    button: 'Kick',
    description: 'Watch Tazo live on Kick — IRL streaming from Japan, traveling around the US and beyond. Join the stream for interactive travel adventures and authentic moments.',
    icon: 'kick',
    showOnHomepage: true,
    featured: true,
    category: 'streaming',
    bg: 'from-[#53fc18] to-[#2f8f0b]',
  },
  {
    id: 'twitch',
    url: 'https://twitch.tv/tazo',
    title: 'Tazo on Twitch',
    button: 'Twitch',
    description: 'Follow Tazo on Twitch for IRL streams, travel content, and variety streaming. Experience real-world adventures and authentic interactions live.',
    icon: 'twitch',
    showOnHomepage: true,
    featured: false,
    category: 'streaming',
    bg: 'from-[#9146FF] to-[#6441A5]',
  },
  {
    id: 'youtube',
    url: 'https://youtube.com/@tazoWTF',
    title: 'Tazo on YouTube',
    button: 'YouTube',
    description: "Watch Tazo's best IRL moments, stream highlights, VODs, and shorts on YouTube. Catch up on missed streams and relive the best adventures.",
    icon: 'youtube',
    showOnHomepage: true,
    featured: false,
    category: 'streaming',
    bg: 'from-[#FF0000] to-[#991b1b]',
    aliases: ['yt', 'vods'],
  },
  {
    id: 'rumble',
    url: 'https://rumble.com/user/Tazo',
    title: "Tazo's Rumble",
    button: 'Rumble',
    description: "Watch Tazo's IRL streaming content and travel adventures on Rumble. Alternative platform for stream highlights and real-world content.",
    icon: 'rumble',
    showOnHomepage: false,
    featured: false,
    category: 'streaming',
    bg: 'from-[#85C742] to-[#4CAF50]',
  },
  {
    id: 'parti',
    url: 'https://parti.com/tazo',
    title: 'Tazo on Parti',
    button: 'Parti',
    description: 'Support Tazo and watch exclusive stream highlights on Parti. Get access to curated IRL moments and behind-the-scenes content.',
    icon: null,
    showOnHomepage: false,
    featured: false,
    category: 'streaming',
    bg: 'from-[#5E00FF] to-[#9B2FFF]',
  },
  {
    id: 'dlive',
    url: 'https://dlive.tv/Tazo',
    title: "Tazo's DLive",
    button: 'DLive',
    description: "Watch Tazo's IRL streams and travel content on DLive. Join live adventures and real-world streaming experiences.",
    icon: null,
    showOnHomepage: false,
    featured: false,
    category: 'streaming',
    bg: 'from-[#FDD835] to-[#FBC02D]',
  },
  {
    id: 'tiktok',
    url: 'https://tiktok.com/@tazowtf',
    title: 'Tazo on TikTok',
    button: 'TikTok',
    description: 'Follow Tazo on TikTok for quick IRL stream highlights, travel moments, and behind-the-scenes clips. Short-form content from real-world adventures.',
    icon: 'tiktok',
    showOnHomepage: true,
    featured: false,
    category: 'social',
    bg: 'from-[#25F4EE] to-[#FE2C55]',
  },
  {
    id: 'instagram',
    url: 'https://instagram.com/tazowtf',
    title: 'Tazo on Instagram',
    button: 'Instagram',
    description: 'Follow Tazo on Instagram for stories, reels, and casual moments from IRL streams. See travel photos and daily life updates.',
    icon: 'instagram',
    showOnHomepage: true,
    featured: false,
    category: 'social',
    bg: 'from-[#f09433] via-[#e6683c] to-[#dc2743]',
    aliases: ['ig'],
  },
  {
    id: 'twitter',
    url: 'https://x.com/tazoWTF',
    title: 'Tazo on Twitter / X',
    button: 'Twitter / X',
    description: 'Follow Tazo on X (Twitter) for stream updates, IRL adventure thoughts, and daily tweets. Stay connected with the latest happenings.',
    icon: 'x',
    showOnHomepage: true,
    featured: false,
    category: 'social',
    bg: 'from-[#1DA1F2] to-[#0f1419]',
    aliases: ['x', 'tweets'],
  },
  {
    id: 'community',
    url: 'https://x.com/i/communities/2011586796648370297',
    title: "Tazo's Twitter / X Community",
    button: 'Twitter / X Community',
    description: "Join Tazo's X Community for posts, discussions, and updates that don't always make it to stream or Discord.",
    icon: 'x',
    showOnHomepage: false,
    featured: false,
    category: 'social',
    bg: 'from-[#1DA1F2] to-[#0f1419]',
    aliases: ['community', 'xcommunity', 'twittercommunity', 'members', 'club'],
  },
  {
    id: 'discord',
    url: 'https://discord.gg/cEhQQR5WgY',
    title: "Tazo's Discord",
    button: 'Discord',
    description: "Join Tazo's Discord community for stream chats, IRL updates, and to connect with other viewers. Get notified when streams go live.",
    icon: 'discord',
    showOnHomepage: true,
    featured: false,
    category: 'social',
    bg: 'from-[#5865F2] to-[#404EED]',
  },
  {
    id: 'onlyfans',
    url: 'https://onlyfans.com/tazoWTF',
    title: "Tazo's OnlyFans",
    button: 'Spicy Page',
    description: "Exclusive behind-the-scenes content and uncensored moments from Tazo's IRL streams. Premium content for supporters.",
    icon: 'onlyfans',
    showOnHomepage: false,
    featured: false,
    category: 'support',
    bg: 'from-[#00AFF0] to-[#005C80]',
    aliases: ['of'],
  },
  {
    id: 'kickbot',
    url: 'https://kickbot.com/tips/tazo',
    title: 'Tazo on KickBot',
    button: 'Tip for TTS',
    description: "Support Tazo's IRL streams on Kick with tips and text-to-speech messages. Your message will be read live during the stream.",
    icon: null,
    showOnHomepage: true,
    featured: false,
    category: 'support',
    bg: 'from-[#22c55e] to-[#15803d]',
    aliases: ['tts'],
  },
  {
    id: 'powerchat',
    url: 'https://powerchat.live/tazo',
    title: 'Tazo on PowerChat',
    button: 'Tip for Media Requests',
    description: "Send messages, media, or music directly to Tazo's stream via PowerChat. Support IRL adventures and interact live.",
    icon: null,
    showOnHomepage: false,
    featured: false,
    category: 'support',
    bg: 'from-[#38bdf8] to-[#0ea5e9]',
    aliases: [],
  },
  {
    id: 'streamelements',
    url: 'https://streamelements.com/tazo/tip',
    title: 'Tazo on StreamElements',
    button: 'Tip for Tasks',
    description: "Support Tazo's IRL streaming adventures with tips, TTS messages, or media requests. Help fund travel and real-world content.",
    icon: null,
    showOnHomepage: true,
    featured: false,
    category: 'support',
    bg: 'from-[#6441A5] to-[#1e90ff]',
    aliases: ['tip', 'donate', 'dono', 'tasks', 'se'],
  },
  {
    id: 'kofi',
    url: 'https://ko-fi.com/tazo',
    title: "Tazo's Ko-fi",
    button: 'Buy Tazo a Coffee',
    description: "Support Tazo's IRL streaming adventures by buying a coffee on Ko-fi. Help fund travel, gear, and real-world content creation.",
    icon: 'kofi',
    showOnHomepage: true,
    featured: false,
    category: 'support',
    bg: 'from-[#FF5E5B] to-[#FF8FA3]',
    aliases: ['coffee'],
  },
  {
    id: 'paypal',
    url: 'https://paypal.me/tazo',
    title: "Tazo's PayPal",
    button: 'Tip with PayPal',
    description: "Send a direct tip to support Tazo's IRL streams and travel adventures. One-time payments via PayPal to help fund content.",
    icon: 'paypal',
    showOnHomepage: false,
    featured: false,
    category: 'support',
    bg: 'from-[#003087] to-[#009CDE]',
  },
  {
    id: 'gear',
    url: 'https://kit.co/tazoWTF/streaming-gear',
    title: "Tazo's Kit.co",
    button: 'Streaming Gear',
    description: 'Check out everything Tazo uses for IRL streaming — cameras, audio equipment, mobile gear, and tech essentials for travel streaming.',
    icon: 'kit',
    showOnHomepage: true,
    featured: false,
    category: 'other',
    bg: 'from-zinc-600 to-zinc-800',
  },
  {
    id: 'wishlist',
    url: 'https://amazon.co.jp/hz/wishlist/ls/2H67SISIKU69Y',
    title: "Tazo's Wishlist",
    button: 'Amazon Wishlist',
    description: "Support Tazo's IRL streaming adventures by sending a gift from the Amazon Japan wishlist. Help fund travel and streaming gear.",
    icon: null,
    showOnHomepage: true,
    featured: false,
    category: 'support',
    bg: 'from-[#FF9900] to-[#FF5E00]',
  },
];

export const CATEGORY_ORDER = ['streaming', 'social', 'support', 'other'] as const;

export const CATEGORY_NAMES: Record<string, string> = {
  streaming: 'Watch',
  social: 'Connect',
  support: 'Support',
  other: 'More',
};

// Build a flat map of slug → URL for the /go/[slug] redirect route
export const LINK_REDIRECT_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const link of LINKS) {
    map[link.id] = link.url;
    for (const alias of link.aliases ?? []) {
      map[alias] = link.url;
    }
  }
  return map;
})();
