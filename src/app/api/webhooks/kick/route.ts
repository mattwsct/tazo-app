import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  getValidAccessToken,
} from '@/lib/kick-api';
import { parseKickChatMessage, handleKickChatCommand } from '@/lib/kick-chat-commands';
import { buildEventMessage } from '@/lib/kick-webhook-handler';
import { getChannelRewardResponse, getRewardInnerPayload } from '@/lib/kick-event-responses';
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
const KICK_RECENT_EVENTS_KEY = 'kick_recent_events';
const REWARD_PAYLOAD_LOG_MAX = 10;
const RECENT_EVENTS_MAX = 25;
const KICK_REWARD_SEEN_PREFIX = 'kick_reward_seen:';
const WEBHOOK_LOG_MAX = 20;
const WEBHOOK_DECISION_LOG_MAX = 15;

async function logWebhookReceived(eventType: string): Promise<void> {
  try {
    await kv.lpush(KICK_WEBHOOK_LOG_KEY, { eventType, at: new Date().toISOString() });
    await kv.ltrim(KICK_WEBHOOK_LOG_KEY, 0, WEBHOOK_LOG_MAX - 1);
  } catch {
    // Ignore log failures
  }
}

function getEventPayloadSummary(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload as Record<string, unknown>;
  const get = (key: string) => (p[key] as { username?: string })?.username;
  switch (eventType) {
    case 'channel.followed': return { follower: get('follower') };
    case 'channel.subscription.new': return { subscriber: get('subscriber') };
    case 'channel.subscription.renewal': return { subscriber: get('subscriber'), duration: p.duration };
    case 'channel.subscription.gifts': return { gifter: get('gifter'), gifteesCount: (p.giftees as unknown[])?.length };
    case 'kicks.gifted': return { sender: get('sender'), amount: (p.gift as { amount?: number })?.amount };
    case 'livestream.status.updated': return { isLive: p.is_live };
    case 'channel.hosted': return { host: get('host') ?? (p.hoster as { username?: string })?.username, viewers: p.viewers };
    default: return {};
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
    console.warn('[Kick webhook] Rejected: bad signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Empty or invalid JSON - still return 200 to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const eventNorm = (eventType || '').toLowerCase().trim();

  // Build event summary for KV (persisted for debugging) and console
  let verifiedMsg: string;
  let eventSummary: Record<string, unknown> = { eventType: eventType || '(none)', at: new Date().toISOString() };
  if (eventNorm === 'chat.message.sent') {
    const data = payload.data as Record<string, unknown> | undefined;
    const p = payload.payload as Record<string, unknown> | undefined;
    const content = String(payload.content ?? data?.content ?? p?.content ?? '').slice(0, 200);
    const sender = ((payload.sender ?? data?.sender ?? p?.sender) as { username?: string })?.username ?? '?';
    verifiedMsg = `chat.message.sent content="${content.slice(0, 80)}" sender=${sender}`;
    eventSummary = { ...eventSummary, content, sender };
  } else if (eventNorm === 'channel.reward.redemption.updated') {
    const inner = getRewardInnerPayload(payload);
    const status = String(inner.status ?? payload.status ?? '').toLowerCase();
    const redeemer = (inner.redeemer as { username?: string })?.username ?? (payload.redeemer as { username?: string })?.username ?? '?';
    const reward = (inner.reward ?? payload.reward) as { title?: string; name?: string } | undefined;
    const title = reward?.title ?? reward?.name ?? '?';
    const userInput = ((inner.user_input ?? payload.user_input) as string)?.slice(0, 100) ?? null;
    verifiedMsg = `channel.reward.redemption.updated status=${status} redeemer=${redeemer} reward="${title}"`;
    eventSummary = { ...eventSummary, status, redeemer, rewardTitle: title, id: inner.id ?? payload.id, userInput };
  } else {
    const summary = getEventPayloadSummary(eventNorm, payload);
    verifiedMsg = `${eventType || '(none)'} ${JSON.stringify(summary)}`;
    eventSummary = { ...eventSummary, ...summary };
  }
  console.log('[Kick webhook] Verified:', verifiedMsg);

  try {
    await kv.lpush(KICK_RECENT_EVENTS_KEY, eventSummary);
    await kv.ltrim(KICK_RECENT_EVENTS_KEY, 0, RECENT_EVENTS_MAX - 1);
  } catch {
    /* ignore */
  }
  await logWebhookReceived(eventType || '(unknown)');

  // Chat commands - parse !ping, !location, !weather, !time and respond
  if (eventType === 'chat.message.sent') {
    const content = (payload.content as string) || '';
    const sender = (payload.sender as { username?: string })?.username ?? '?';
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
      console.error('[Kick webhook] Chat command failed:', err instanceof Error ? err.message : String(err));
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const [storedTemplates, storedEnabled, storedTemplateEnabled, storedAlertSettings] = await Promise.all([
    kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
    kv.get<Partial<Record<KickEventToggleKey, boolean>>>(KICK_MESSAGE_ENABLED_KEY),
    kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
    kv.get<{ minimumKicks?: number; giftSubShowLifetimeSubs?: boolean }>(KICK_ALERT_SETTINGS_KEY),
  ]);

  const templates: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
  const enabled: Record<KickEventToggleKey, boolean> = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...(storedEnabled ?? {}) };
  const templateEnabled: KickMessageTemplateEnabled = { ...(storedTemplateEnabled ?? {}) };
  const minimumKicks = storedAlertSettings?.minimumKicks ?? 0;
  const giftSubShowLifetimeSubs = storedAlertSettings?.giftSubShowLifetimeSubs !== false;

  // Normalize event type (Kick may send different casing) and look up toggle
  const eventTypeNorm = (eventType || '').toLowerCase().trim();
  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventTypeNorm] ?? EVENT_TYPE_TO_TOGGLE[eventType];
  const toggleValue = toggleKey ? enabled[toggleKey] : undefined;

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

  const rewardInner = eventTypeNorm === 'channel.reward.redemption.updated' ? getRewardInnerPayload(payload) : null;
  const debugPayload =
    rewardInner
      ? (() => {
          const reward = (rewardInner.reward ?? payload.reward) as { title?: string; name?: string } | undefined;
          const redeemer = (rewardInner.redeemer as { username?: string })?.username ?? (payload.redeemer as { username?: string })?.username;
          return {
            at: new Date().toISOString(),
            id: rewardInner.id ?? payload.id,
            status: String(rewardInner.status ?? payload.status ?? '').toLowerCase(),
            redeemer,
            rewardTitle: reward?.title ?? reward?.name ?? '?',
            userInput: ((rewardInner.user_input ?? payload.user_input) as string)?.slice(0, 100) ?? null,
            payloadKeys: Object.keys(payload),
          };
        })()
      : undefined;
  try {
    if (debugPayload) {
      try {
        await kv.lpush(KICK_REWARD_PAYLOAD_LOG_KEY, debugPayload);
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
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const buildOptions = {
    templates,
    templateEnabled,
    minimumKicks,
    giftSubShowLifetimeSubs,
    getAccessToken: getValidAccessToken,
  };

  let message: string | null;
  if (eventTypeNorm === 'channel.reward.redemption.updated' && rewardInner) {
    const redemptionId = String(rewardInner.id ?? payload.id ?? '');
    const status = String(rewardInner.status ?? payload.status ?? '').toLowerCase();
    const seenKey = redemptionId ? `${KICK_REWARD_SEEN_PREFIX}${redemptionId}` : null;
    const alreadySeen = !!seenKey && (await kv.get(seenKey));
    if (alreadySeen) {
      message = getChannelRewardResponse(payload, templates, { forceApproved: true }, templateEnabled);
    } else {
      message = await buildEventMessage(eventTypeNorm, payload, buildOptions);
      if (message && seenKey) {
        try {
          await kv.set(seenKey, 1);
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    message = await buildEventMessage(eventTypeNorm, payload, buildOptions);
  }

  if (!message || !message.trim()) {
    await pushDecision('skipped_empty_template');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    await pushDecision('skipped_no_token');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const debugPrefix = process.env.KICK_MESSAGE_DEBUG_PREFIX ?? '';
  const finalMessage = debugPrefix ? `${debugPrefix}${message}` : message;

  try {
    await sendKickChatMessage(accessToken, finalMessage);
    await pushDecision('sent');
  } catch (err) {
    await pushDecision('send_failed');
    console.error('[Kick webhook] Chat send failed:', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
