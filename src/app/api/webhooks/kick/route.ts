import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  getValidAccessToken,
} from '@/lib/kick-api';
import { parseKickChatMessage, handleKickChatCommand } from '@/lib/kick-chat-commands';
import { buildEventMessage } from '@/lib/kick-webhook-handler';
import { getChannelRewardResponse } from '@/lib/kick-event-responses';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
  EVENT_TYPE_TO_TOGGLE,
  KICK_MESSAGES_KEY,
  KICK_MESSAGE_ENABLED_KEY,
  KICK_MESSAGE_TEMPLATE_ENABLED_KEY,
  KICK_ALERT_SETTINGS_KEY,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickEventToggleKey, KickMessageTemplateEnabled } from '@/types/kick-messages';
const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';
const KICK_WEBHOOK_DECISION_LOG_KEY = 'kick_webhook_decision_log';
const KICK_REWARD_PAYLOAD_LOG_KEY = 'kick_reward_payload_log';
const REWARD_PAYLOAD_LOG_MAX = 10;
const KICK_REWARD_SEEN_PREFIX = 'kick_reward_seen:';
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

  console.log('[Kick webhook] WEBHOOK_IN', JSON.stringify({ eventType: eventType || '(none)', bodyLen: rawBody.length, hasSig, hasMsgId, hasTs }));

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
    console.warn('[Kick webhook] WEBHOOK_REJECT', JSON.stringify({ reason: 'bad_signature', eventType: eventType || '(none)' }));
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log('[Kick webhook] WEBHOOK_VERIFIED', JSON.stringify({ eventType: eventType || '(none)' }));
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
    const sender = (payload.sender as { username?: string })?.username ?? '?';
    const parsed = parseKickChatMessage(content);
    console.log('[Kick webhook] CHAT_CMD_IN', JSON.stringify({ eventType, sender, contentLen: content.length, parsed: parsed ? { cmd: parsed.cmd, args: parsed.args } : null }));
    if (!parsed) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    const response = await handleKickChatCommand(parsed.cmd, parsed.args);
    console.log('[Kick webhook] CHAT_CMD_RESPONSE', JSON.stringify({ cmd: parsed.cmd, args: parsed.args, hasResponse: !!response, responsePreview: response?.slice(0, 80) ?? null }));
    if (!response) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      console.log('[Kick webhook] CHAT_CMD_SKIP', JSON.stringify({ reason: 'no_token', cmd: parsed.cmd }));
      return NextResponse.json({ received: true }, { status: 200 });
    }
    try {
      await sendKickChatMessage(accessToken, response);
      console.log('[Kick webhook] CHAT_CMD_SENT', JSON.stringify({ cmd: parsed.cmd, responsePreview: response.slice(0, 80) }));
    } catch (err) {
      console.error('[Kick webhook] CHAT_CMD_FAIL', JSON.stringify({ cmd: parsed.cmd, error: err instanceof Error ? err.message : String(err) }));
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  console.log('[Kick webhook] EVENT_PATH', JSON.stringify({ eventType: eventType || '(none)', eventTypeNorm: (eventType || '').toLowerCase().trim() }));

  const [storedTemplates, storedEnabled, storedTemplateEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<Partial<Record<KickEventToggleKey, boolean>>>(KICK_MESSAGE_ENABLED_KEY),
    kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);

  console.log('[Kick webhook] KV_READ', JSON.stringify({ hasTemplates: !!storedTemplates, hasEnabled: !!storedEnabled, hasTemplateEnabled: !!storedTemplateEnabled, hasAlertSettings: !!storedAlertSettings }));

  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const enabled: Record<KickEventToggleKey, boolean> = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...(storedEnabled ?? {}) };
  const templateEnabled: KickMessageTemplateEnabled = { ...(storedTemplateEnabled ?? {}) };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  // Normalize event type (Kick may send different casing) and look up toggle
  const eventTypeNorm = (eventType || '').toLowerCase().trim();
  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] ?? EVENT_TYPE_TO_TOGGLE[eventType];
  const toggleValue = toggleKey ? enabled[toggleKey] : undefined;

  console.log('[Kick webhook] TOGGLE_CHECK', JSON.stringify({ eventTypeNorm, toggleKey, toggleValue, enabledSnapshot: enabled }));

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
    const rewardInner =
      eventTypeNorm === 'channel.reward.redemption.updated'
        ? ((payload.data ?? payload.payload ?? payload) as Record<string, unknown>)
        : null;
    const debugPayload =
      eventTypeNorm === 'channel.reward.redemption.updated' && rewardInner
        ? {
            id: rewardInner.id ?? payload.id ?? (payload.data as Record<string, unknown>)?.id ?? (payload.payload as Record<string, unknown>)?.id,
            status: rewardInner.status ?? payload.status ?? (payload.data as Record<string, unknown>)?.status ?? (payload.payload as Record<string, unknown>)?.status,
            keys: Object.keys(payload),
            innerKeys: Object.keys(rewardInner),
            rawTopLevel: { id: payload.id, status: payload.status, hasData: !!payload.data, hasPayload: !!payload.payload },
          }
        : undefined;
    if (debugPayload) {
      try {
        await kv.lpush(KICK_REWARD_PAYLOAD_LOG_KEY, { ...debugPayload, at: new Date().toISOString() });
        await kv.ltrim(KICK_REWARD_PAYLOAD_LOG_KEY, 0, REWARD_PAYLOAD_LOG_MAX - 1);
      } catch {
        /* ignore */
      }
    }
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
      channelRewardPayload: debugPayload,
    });
  } catch {
    // Ignore
  }

  const isKnownEvent = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] !== undefined || EVENT_TYPE_TO_TOGGLE[eventType] !== undefined;
  if (!isKnownEvent) {
    console.log('[Kick webhook] CHAT_SKIP', JSON.stringify({ reason: 'unknown_event', eventType: eventType || '(none)', eventTypeNorm }));
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let message: string | null;
  if (eventTypeNorm === 'channel.reward.redemption.updated') {
    const inner = (payload.data ?? payload.payload ?? payload) as Record<string, unknown>;
    const redemptionId = String(inner.id ?? payload.id ?? '');
    const status = String(inner.status ?? payload.status ?? '').toLowerCase();
    const payloadKeys = Object.keys(payload);
    const innerKeys = Object.keys(inner);
    console.log(
      '[Kick webhook] REWARD_DEBUG',
      JSON.stringify({
        id: redemptionId,
        status,
        payloadTopLevel: { id: payload.id, status: payload.status, hasData: !!payload.data, hasPayload: !!payload.payload },
        payloadKeys,
        innerKeys,
      })
    );
    const seenKey = redemptionId ? `${KICK_REWARD_SEEN_PREFIX}${redemptionId}` : null;
    const alreadySeen = seenKey ? await kv.get(seenKey) : null;
    let templateUsed: string;
    if (alreadySeen) {
      message = getChannelRewardResponse(payload, templates, { forceApproved: true }, templateEnabled);
      templateUsed = 'channelRewardApproved (id seen, dedup)';
    } else {
      message = await buildEventMessage(eventTypeNorm, payload, {
        templates,
        templateEnabled,
        minimumKicks,
        giftSubShowLifetimeSubs,
        getAccessToken: getValidAccessToken,
      });
      if (message && seenKey) {
        try {
          await kv.set(seenKey, 1);
        } catch {
          // ignore
        }
      }
      templateUsed =
        status === 'accepted' || status === 'fulfilled' || status === 'approved'
          ? 'channelRewardApproved'
          : status === 'rejected' || status === 'denied' || status === 'canceled'
            ? 'channelRewardDeclined'
            : status
              ? `channelReward/WithInput (status=${status})`
              : 'channelReward/WithInput (status missing)';
    }
    console.log('[Kick webhook] REWARD_DECISION', JSON.stringify({ id: redemptionId, status, alreadySeen: !!alreadySeen, templateUsed, msgPreview: message?.slice(0, 60) ?? null }));
  } else {
    message = await buildEventMessage(eventTypeNorm, payload, {
      templates,
      templateEnabled,
      minimumKicks,
      giftSubShowLifetimeSubs,
      getAccessToken: getValidAccessToken,
    });
    const payloadSummary = eventTypeNorm === 'channel.followed' ? { follower: (payload.follower as { username?: string })?.username }
      : eventTypeNorm === 'channel.subscription.new' ? { subscriber: (payload.subscriber as { username?: string })?.username }
      : eventTypeNorm === 'channel.subscription.renewal' ? { subscriber: (payload.subscriber as { username?: string })?.username, duration: payload.duration }
      : eventTypeNorm === 'channel.subscription.gifts' ? { gifter: (payload.gifter as { username?: string })?.username, gifteesCount: (payload.giftees as unknown[])?.length }
      : eventTypeNorm === 'kicks.gifted' ? { sender: (payload.sender as { username?: string })?.username, amount: (payload.gift as { amount?: number })?.amount }
      : eventTypeNorm === 'livestream.status.updated' ? { isLive: payload.is_live }
      : eventTypeNorm === 'channel.hosted' ? { host: (payload.host as { username?: string })?.username, viewers: payload.viewers }
      : {};
    console.log('[Kick webhook] CHAT_RESPONSE', JSON.stringify({ eventType: eventTypeNorm, toggleKey, payloadSummary, hasMessage: !!message, msgPreview: message?.slice(0, 80) ?? null }));
  }

  if (!message || !message.trim()) {
    console.log('[Kick webhook] CHAT_SKIP', JSON.stringify({ reason: 'empty_template', eventType: eventTypeNorm, toggleKey }));
    await pushDecision('skipped_empty_template');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.log('[Kick webhook] CHAT_SKIP', JSON.stringify({ reason: 'no_token', eventType: eventTypeNorm }));
    await pushDecision('skipped_no_token');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const debugPrefix = process.env.KICK_MESSAGE_DEBUG_PREFIX ?? '';
  const finalMessage = debugPrefix ? `${debugPrefix}${message}` : message;

  try {
    await sendKickChatMessage(accessToken, finalMessage);
    await pushDecision('sent');
    console.log('[Kick webhook] CHAT_SENT', JSON.stringify({ eventType: eventTypeNorm, toggleKey, msgLen: finalMessage.length, msgPreview: finalMessage.slice(0, 100) }));
  } catch (err) {
    await pushDecision('send_failed');
    console.error('[Kick webhook] CHAT_FAIL', JSON.stringify({ eventType: eventTypeNorm, error: err instanceof Error ? err.message : String(err) }));
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
