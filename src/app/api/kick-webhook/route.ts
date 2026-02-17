import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  getValidAccessToken,
} from '@/lib/kick-api';
import { buildEventMessage } from '@/lib/kick-webhook-handler';
import {
  DEFAULT_KICK_MESSAGES,
  EVENT_TYPE_TO_TOGGLE,
  KICK_MESSAGES_KEY,
  KICK_MESSAGE_TEMPLATE_ENABLED_KEY,
  KICK_ALERT_SETTINGS_KEY,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageTemplateEnabled } from '@/types/kick-messages';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

  const [storedTemplates, storedTemplateEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);
  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const templateEnabled: KickMessageTemplateEnabled = { ...(storedTemplateEnabled ?? {}) };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  const eventTypeNorm = (eventType || '').toLowerCase().trim();
  const isKnownEvent = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] !== undefined || EVENT_TYPE_TO_TOGGLE[eventType] !== undefined;
  if (!isKnownEvent) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const message = await buildEventMessage(eventTypeNorm, payload, {
    templates,
    templateEnabled,
    minimumKicks,
    giftSubShowLifetimeSubs,
    getAccessToken: getValidAccessToken,
  });

  if (!message || !message.trim()) {
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
