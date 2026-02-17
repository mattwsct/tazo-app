import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  getValidAccessToken,
} from '@/lib/kick-api';
import { parseKickChatMessage, handleKickChatCommand } from '@/lib/kick-chat-commands';
import { buildEventMessage } from '@/lib/kick-webhook-handler';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
  EVENT_TYPE_TO_TOGGLE,
  KICK_MESSAGES_KEY,
  KICK_MESSAGE_ENABLED_KEY,
  KICK_ALERT_SETTINGS_KEY,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickEventToggleKey } from '@/types/kick-messages';
const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';
const KICK_WEBHOOK_DECISION_LOG_KEY = 'kick_webhook_decision_log';
const WEBHOOK_LOG_MAX = 20;
const WEBHOOK_DECISION_LOG_MAX = 15;

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

  console.log('[Kick webhook] Event path', eventType);

  const [storedTemplates, storedEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<Partial<Record<KickEventToggleKey, boolean>>>(KICK_MESSAGE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);

  console.log('[Kick webhook] KV read', { storedEnabled: JSON.stringify(storedEnabled), key: KICK_MESSAGE_ENABLED_KEY });

  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const enabled: Record<KickEventToggleKey, boolean> = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...(storedEnabled ?? {}) };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  // Normalize event type (Kick may send different casing) and look up toggle
  const eventTypeNorm = (eventType || '').toLowerCase().trim();
  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] ?? EVENT_TYPE_TO_TOGGLE[eventType];
  const toggleValue = toggleKey ? enabled[toggleKey] : undefined;

  console.log('[Kick webhook] Toggle check', {
    eventType,
    eventTypeNorm,
    toggleKey,
    toggleValue,
    channelRewardFromEnabled: enabled.channelReward,
  });

  const pushDecision = async (action: string) => {
    try {
      await kv.lpush(KICK_WEBHOOK_DECISION_LOG_KEY, {
        at: new Date().toISOString(),
        eventType: eventType || '(none)',
        toggleKey: toggleKey ?? null,
        toggleValue: toggleValue ?? null,
        action,
        storedEnabledRaw: storedEnabled ?? null,
      });
      await kv.ltrim(KICK_WEBHOOK_DECISION_LOG_KEY, 0, WEBHOOK_DECISION_LOG_MAX - 1);
    } catch { /* ignore */ }
  };

  try {
    await kv.set(KICK_WEBHOOK_DEBUG_KEY, {
      at: new Date().toISOString(),
      eventType: eventType || '(none)',
      eventTypeNorm,
      bodyLen: rawBody.length,
      storedEnabledRaw: storedEnabled ?? null,
      enabledSnapshot: enabled,
      toggleKey: toggleKey ?? null,
      toggleValue: toggleValue ?? null,
      verified: !!verified,
    });
  } catch {
    // Ignore
  }

  const isKnownEvent = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] !== undefined || EVENT_TYPE_TO_TOGGLE[eventType] !== undefined;
  if (!isKnownEvent) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const message = await buildEventMessage(eventTypeNorm, payload, {
    templates,
    minimumKicks,
    giftSubShowLifetimeSubs,
    getAccessToken: getValidAccessToken,
  });

  if (!message || !message.trim()) {
    await pushDecision('skipped_empty_template');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    await pushDecision('skipped_no_token');
    console.warn('[Kick webhook] No valid token - cannot send chat response');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const debugPrefix = process.env.KICK_MESSAGE_DEBUG_PREFIX ?? '';
  const finalMessage = debugPrefix ? `${debugPrefix}${message}` : message;

  try {
    await sendKickChatMessage(accessToken, finalMessage);
    await pushDecision('sent');
    console.log('[Kick webhook] Sent:', eventType, '|', toggleKey, '| message:', finalMessage.slice(0, 50) + (finalMessage.length > 50 ? '...' : ''));
  } catch (err) {
    await pushDecision('send_failed');
    console.error('[Kick webhook] Chat send failed:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
