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
  parseKickChatMessage,
  handleKickChatCommand,
} from '@/lib/kick-chat-commands';
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
const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';
const WEBHOOK_LOG_MAX = 20;

async function logWebhookReceived(eventType: string): Promise<void> {
  try {
    const entry = { eventType, at: new Date().toISOString() };
    await kv.lpush(KICK_WEBHOOK_LOG_KEY, entry);
    await kv.ltrim(KICK_WEBHOOK_LOG_KEY, 0, WEBHOOK_LOG_MAX - 1);
  } catch {
    // Ignore log failures
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET - Webhook URL verification.
 * Kick (or similar) may send a GET when subscribing to verify the URL is reachable.
 * Some APIs use hub.mode=subscribe&hub.challenge=xxx — echo the challenge if present.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const hubMode = url.searchParams.get('hub.mode') ?? url.searchParams.get('hub_mode');
  const hubChallenge = url.searchParams.get('hub.challenge') ?? url.searchParams.get('hub_challenge');
  console.log('[Kick webhook] GET verification', { hubMode, hasChallenge: !!hubChallenge });
  if (hubMode === 'subscribe' && hubChallenge) {
    return new NextResponse(hubChallenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ status: 'ok', message: 'Kick webhook endpoint' }, { status: 200 });
}

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
  const hasSig = !!(headers['kick-event-signature'] ?? headers['Kick-Event-Signature']);
  const hasMsgId = !!(headers['kick-event-message-id'] ?? headers['Kick-Event-Message-Id']);
  const hasTs = !!(headers['kick-event-message-timestamp'] ?? headers['Kick-Event-Message-Timestamp']);

  console.log('[Kick webhook] Received', {
    eventType: eventType || '(none)',
    bodyLen: rawBody.length,
    hasSig,
    hasMsgId,
    hasTs,
  });

  const verified = verifyKickWebhookSignature(rawBody, headers);
  try {
    await kv.set(KICK_WEBHOOK_DEBUG_KEY, {
      at: new Date().toISOString(),
      eventType: eventType || '(none)',
      bodyLen: rawBody.length,
      hasSig,
      hasMsgId,
      hasTs,
      verified,
    });
  } catch {
    // Ignore
  }

  if (!verified) {
    console.warn('[Kick webhook] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log('[Kick webhook] Verified:', eventType);
  await logWebhookReceived(eventType || '(unknown)');

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Empty or invalid JSON - still return 200 to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Chat commands - parse !ping, !location, !weather, !time and respond
  if (eventType === 'chat.message.sent') {
    const content = (payload.content as string) || '';
    const parsed = parseKickChatMessage(content);
    if (!parsed) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    const response = await handleKickChatCommand(parsed.cmd, parsed.args);
    if (!response) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    try {
      await sendKickChatMessage(accessToken, response);
    } catch (err) {
      console.error('[Kick webhook] Chat command send failed:', err);
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const [storedTemplates, storedEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<Partial<Record<KickEventToggleKey, boolean>>>(KICK_MESSAGE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);
  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventType];
  const isExplicitlyEnabled = toggleKey ? enabled[toggleKey] === true : true;
  if (toggleKey && !isExplicitlyEnabled) {
    console.log('[Kick webhook] Skipping', eventType, '|', toggleKey + ':', enabled[toggleKey]);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let message: string | null = null;
  switch (eventType) {
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
      if (amount < minimumKicks) {
        break;
      }
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

  try {
    await sendKickChatMessage(accessToken, message);
  } catch (err) {
    console.error('[Kick webhook] Chat send failed:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
