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
} from '@/lib/kick-event-responses';
import {
  parseKickChatMessage,
  handleKickChatCommand,
} from '@/lib/kick-chat-commands';
import { DEFAULT_KICK_MESSAGES } from '@/types/kick-messages';
import type { KickMessageTemplates } from '@/types/kick-messages';

const KICK_TOKENS_KEY = 'kick_tokens';
const KICK_MESSAGES_KEY = 'kick_message_templates';
const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const WEBHOOK_LOG_MAX = 20;

async function logWebhookReceived(eventType: string): Promise<void> {
  try {
    const entry = { eventType, at: new Date().toISOString() };
    const existing = (await kv.lrange<{ eventType: string; at: string }[]>(KICK_WEBHOOK_LOG_KEY, 0, WEBHOOK_LOG_MAX - 2)) ?? [];
    await kv.lpush(KICK_WEBHOOK_LOG_KEY, entry);
    await kv.ltrim(KICK_WEBHOOK_LOG_KEY, 0, WEBHOOK_LOG_MAX - 1);
  } catch {
    // Ignore log failures
  }
}

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
  console.log('[Kick webhook] Received', eventType || '(no event type)');

  if (!verifyKickWebhookSignature(rawBody, headers)) {
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

  const storedTemplates = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };

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
    case 'channel.subscription.gifts':
      message = getGiftSubResponse(payload, templates);
      break;
    case 'kicks.gifted':
      message = getKicksGiftedResponse(payload, templates);
      break;
    case 'channel.reward.redemption.updated':
      message = getChannelRewardResponse(payload, templates);
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
