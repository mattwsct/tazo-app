import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  refreshKickTokens,
} from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';
import {
  getFollowResponse,
  getNewSubResponse,
  getResubResponse,
  getGiftSubResponse,
  getKicksGiftedResponse,
  getChannelRewardResponse,
  getStreamStatusResponse,
  getHostResponse,
} from '@/lib/kick-event-responses';
import { getKickSubscriptionLeaderboard } from '@/lib/kick-api';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
  EVENT_TYPE_TO_TOGGLE,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickEventToggleKey } from '@/types/kick-messages';

const KICK_TOKENS_KEY = 'kick_tokens';
const KICK_MESSAGES_KEY = 'kick_message_templates';
const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';
const KICK_ALERT_SETTINGS_KEY = 'kick_alert_settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function getValidAccessToken(): Promise<string | null> {
  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) return null;

  const now = Date.now();
  const bufferMs = 60 * 1000; // Refresh 1 min before expiry
  if (stored.expires_at - bufferMs > now) {
    return stored.access_token;
  }

  try {
    const tokens = await refreshKickTokens(stored.refresh_token);
    const expiresAt = now + tokens.expires_in * 1000;
    await kv.set(KICK_TOKENS_KEY, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
    });
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  const eventType = headers['kick-event-type'] ?? headers['Kick-Event-Type'] ?? '';
  console.log('[Kick webhook /api/kick-webhook] Received', eventType || '(no event type)');

  if (!verifyKickWebhookSignature(rawBody, headers)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Empty or invalid JSON - still return 200 to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Events we don't auto-respond to (chat.message.sent would spam)
  const skipResponse = ['chat.message.sent'];
  if (skipResponse.includes(eventType)) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const [storedTemplates, storedEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<Partial<Record<KickEventToggleKey, boolean>>>(KICK_MESSAGE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);
  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...(storedEnabled ?? {}) };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  const eventTypeNorm = (eventType || '').toLowerCase().trim();
  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] ?? EVENT_TYPE_TO_TOGGLE[eventType];
  const toggleValue = toggleKey ? enabled[toggleKey] : undefined;
  const isDisabled = toggleKey && (toggleValue === false || String(toggleValue) === 'false');

  console.log('[Kick webhook] Toggle check', { eventType, eventTypeNorm, toggleKey, toggleValue, isDisabled, storedEnabled: JSON.stringify(storedEnabled) });

  if (isDisabled) {
    console.log('[Kick webhook] Skipping (toggle off)', eventType, toggleKey);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let message: string | null = null;
  switch (eventTypeNorm) {
    case 'channel.followed':
      message = getFollowResponse(payload, templates);
      break;
    case 'channel.subscription.new':
      message = getNewSubResponse(payload, templates);
      break;
    case 'channel.subscription.renewal':
      message = getResubResponse(payload, templates);
      break;
    case 'channel.subscription.gifts': {
      let lifetimeSubs = '';
      if (giftSubShowLifetimeSubs) {
        const accessTokenForLeaderboard = await getValidAccessToken();
        if (accessTokenForLeaderboard) {
          try {
            const leaderboard = await getKickSubscriptionLeaderboard(accessTokenForLeaderboard);
            const gifter = payload.gifter as { username?: string; is_anonymous?: boolean } | undefined;
            if (gifter && !gifter.is_anonymous) {
              const username = gifter.username;
              if (username) {
                const total = leaderboard.get(username.toLowerCase());
                if (total != null && total > 0) {
                  lifetimeSubs = `(${total} lifetime)`;
                }
              }
            }
          } catch {
            // Leaderboard fetch failed - continue without lifetime subs
          }
        }
      }
      message = getGiftSubResponse(payload, templates, { lifetimeSubs });
      break;
    }
    case 'kicks.gifted': {
      const amount = Number((payload.gift as { amount?: number })?.amount ?? 0);
      if (amount < minimumKicks) break;
      message = getKicksGiftedResponse(payload, templates);
      break;
    }
    case 'channel.reward.redemption.updated':
      message = getChannelRewardResponse(payload, templates);
      break;
    case 'livestream.status.updated':
      message = getStreamStatusResponse(payload, templates);
      break;
    case 'channel.hosted':
      message = getHostResponse(payload, templates);
      break;
    default:
      // Unknown event - acknowledge but don't respond
      return NextResponse.json({ received: true }, { status: 200 });
  }

  if (!message) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.warn('[Kick webhook] No valid token - cannot send chat response');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const debugPrefix = process.env.KICK_MESSAGE_DEBUG_PREFIX ?? '';
  const finalMessage = debugPrefix ? `${debugPrefix}${message}` : message;

  try {
    await sendKickChatMessage(accessToken, finalMessage);
  } catch (err) {
    console.error('[Kick webhook] Chat send failed:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
