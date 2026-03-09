import { NextResponse } from 'next/server';
import { cleanQuery } from '@/utils/chat-utils';
import { txtResponse } from './shared';

const SOCIAL_ROUTES: Record<string, { name: string; url: (u: string) => string; fallback: string }> = {
  instagram: { name: 'Instagram', url: (u) => `https://instagram.com/${u}`, fallback: 'https://tazo.wtf/instagram' },
  tiktok: { name: 'TikTok', url: (u) => `https://tiktok.com/@${u}`, fallback: 'https://tazo.wtf/tiktok' },
  youtube: { name: 'YouTube', url: (u) => `https://youtube.com/@${u}`, fallback: 'https://tazo.wtf/youtube' },
  twitter: { name: 'Twitter', url: (u) => `https://x.com/${u}`, fallback: 'https://tazo.wtf/twitter' },
  kick: { name: 'Kick', url: (u) => `https://kick.com/${u}`, fallback: 'https://tazo.wtf/kick' },
  rumble: { name: 'Rumble', url: (u) => `https://rumble.com/user/${u}`, fallback: 'https://tazo.wtf/rumble' },
  twitch: { name: 'Twitch', url: (u) => `https://twitch.tv/${u}`, fallback: 'https://tazo.wtf/twitch' },
  parti: { name: 'Parti', url: (u) => `https://parti.live/${u}`, fallback: 'https://tazo.wtf/parti' },
  dlive: { name: 'DLive', url: (u) => `https://dlive.tv/${u}`, fallback: 'https://tazo.wtf/dlive' },
};

export function handleSocialRoutes(route: string, q: string, provider?: string): NextResponse | null {
  // Social media routes
  if (route in SOCIAL_ROUTES) {
    const config = SOCIAL_ROUTES[route];
    const socialUser = cleanQuery(q);
    return txtResponse(
      socialUser
        ? `${config.name} → ${config.url(socialUser)}`
        : `${config.name} → ${config.fallback}`
    );
  }

  // Shoutout route
  if (route === 'shoutout' || route === 'so') {
    const socialUser = cleanQuery(q);
    if (!socialUser) return txtResponse('Usage: !so <username>');

    const providerStr = (provider || '').toLowerCase();
    const providers: Record<string, (u: string) => string> = {
      twitch: (u) => `https://twitch.tv/${u}`,
      youtube: (u) => `https://youtube.com/@${u}`,
    };

    const link = providers[providerStr]?.(socialUser) || `https://kick.com/${socialUser}`;
    return txtResponse(`Check out ${socialUser} → ${link}`);
  }

  return null;
}
