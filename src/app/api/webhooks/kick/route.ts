import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  verifyKickWebhookSignature,
  sendKickChatMessage,
  getValidAccessToken,
} from '@/lib/kick-api';
import { parseKickChatMessage, handleKickChatCommand } from '@/lib/kick-chat-commands';
import { handleChatPoll } from '@/lib/poll-webhook-handler';
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
import { KICK_LAST_CHAT_MESSAGE_AT_KEY } from '@/types/poll';
import { onStreamStarted } from '@/utils/stats-storage';
import { resetLeaderboardOnStreamStart, addChatPoints, addFollowPoints, addSubPoints, addGiftSubPoints, addKicksPoints } from '@/utils/leaderboard-storage';
import { pushSubAlert, pushResubAlert, pushGiftSubAlert, pushKicksAlert } from '@/utils/overlay-alerts-storage';
import { broadcastAlertsAndLeaderboard } from '@/lib/alerts-broadcast';
import { getWellnessData, resetStepsSession, resetDistanceSession, resetHandwashingSession, resetFlightsSession, resetWellnessLastImport, resetWellnessMilestonesOnStreamStart } from '@/utils/wellness-storage';
import { resetStreamGoalsOnStreamStart, addStreamGoalSubs, addStreamGoalKicks, getStreamGoals } from '@/utils/stream-goals-storage';
import { clearGoalCelebrationOnStreamStart } from '@/utils/stream-goals-celebration';
import { setGoalCelebrationIfNeeded } from '@/utils/stream-goals-celebration';
import type { KickMessageTemplates, KickEventToggleKey, KickMessageTemplateEnabled } from '@/types/kick-messages';
import { isToggleDisabled } from '@/types/kick-messages';
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

  const verified = verifyKickWebhookSignature(rawBody, headers);
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
    const content = String(payload.content ?? '').slice(0, 200);
    const sender = (payload.sender as { username?: string })?.username ?? '?';
    verifiedMsg = `chat.message.sent content="${content.slice(0, 80)}" sender=${sender}`;
    eventSummary = { ...eventSummary, content, sender };
  } else if (eventNorm === 'channel.reward.redemption.updated') {
    const status = String(payload.status ?? '').toLowerCase();
    const redeemer = (payload.redeemer as { username?: string })?.username ?? '?';
    const reward = payload.reward as { title?: string; name?: string } | undefined;
    const title = reward?.title ?? reward?.name ?? '?';
    const userInput = (payload.user_input as string)?.slice(0, 100) ?? null;
    verifiedMsg = `channel.reward.redemption.updated status=${status} redeemer=${redeemer} reward="${title}"`;
    eventSummary = { ...eventSummary, status, redeemer, rewardTitle: title, id: payload.id, userInput };
  } else {
    const summary = getEventPayloadSummary(eventNorm, payload);
    verifiedMsg = `${eventType || '(none)'} ${JSON.stringify(summary)}`;
    eventSummary = { ...eventSummary, ...summary };
  }
  console.log('[Kick webhook] Verified:', verifiedMsg);

  const enableWebhookLogging = process.env.KICK_WEBHOOK_LOGGING === 'true';
  if (enableWebhookLogging) {
    try {
      await kv.lpush(KICK_RECENT_EVENTS_KEY, eventSummary);
      await kv.ltrim(KICK_RECENT_EVENTS_KEY, 0, RECENT_EVENTS_MAX - 1);
      await kv.set(KICK_WEBHOOK_DEBUG_KEY, { at: new Date().toISOString(), eventType: eventType || '(none)', verified: true });
    } catch {
      /* ignore */
    }
    await logWebhookReceived(eventType || '(unknown)');
  }

  // Stream start: reset stats session, steps counter, and leaderboard when going live
  if (eventNorm === 'livestream.status.updated' && payload.is_live === true) {
    void onStreamStarted();
    void resetLeaderboardOnStreamStart();
    void (async () => {
      try {
        const wellness = await getWellnessData();
        await resetStepsSession(wellness?.steps ?? 0);
        await resetDistanceSession(wellness?.distanceKm ?? 0);
        await resetHandwashingSession(wellness?.handwashingCount ?? 0);
        await resetFlightsSession(wellness?.flightsClimbed ?? 0);
        await resetWellnessLastImport();
        await resetWellnessMilestonesOnStreamStart();
        await resetStreamGoalsOnStreamStart();
        await clearGoalCelebrationOnStreamStart();
      } catch (e) {
        console.warn('Failed to reset wellness session on stream start:', e);
      }
    })();
  }

  // Chat: poll handling first (if enabled), then !ping. Award leaderboard points for chat.
  if (eventNorm === 'chat.message.sent') {
    const content = (payload.content as string) || '';
    const sender = (payload.sender as { username?: string })?.username ?? '?';
    void addChatPoints(sender);
    try {
      await kv.set(KICK_LAST_CHAT_MESSAGE_AT_KEY, Date.now());
    } catch { /* ignore */ }
    const pollResult = await handleChatPoll(content, sender, payload);
    if (pollResult.handled) return NextResponse.json({ received: true }, { status: 200 });

    const parsed = parseKickChatMessage(content);
    if (!parsed) return NextResponse.json({ received: true }, { status: 200 });
    const response = await handleKickChatCommand(parsed.cmd, sender);
    if (!response) return NextResponse.json({ received: true }, { status: 200 });
    const accessToken = await getValidAccessToken();
    if (!accessToken) return NextResponse.json({ received: true }, { status: 200 });
    const messageId = (payload.id ?? payload.message_id) as string | undefined;
    try {
      await sendKickChatMessage(accessToken, response, messageId ? { replyToMessageId: messageId } : undefined);
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

  const toggleKey = EVENT_TYPE_TO_TOGGLE[eventNorm] ?? EVENT_TYPE_TO_TOGGLE[eventType];
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

  if (eventNorm === 'channel.reward.redemption.updated') {
    const reward = payload.reward as { title?: string; name?: string } | undefined;
    const rewardLog = {
      at: new Date().toISOString(),
      id: payload.id,
      status: String(payload.status ?? '').toLowerCase(),
      redeemer: (payload.redeemer as { username?: string })?.username,
      rewardTitle: reward?.title ?? reward?.name ?? '?',
      userInput: (payload.user_input as string)?.slice(0, 100) ?? null,
    };
    try {
      await kv.lpush(KICK_REWARD_PAYLOAD_LOG_KEY, rewardLog);
      await kv.ltrim(KICK_REWARD_PAYLOAD_LOG_KEY, 0, REWARD_PAYLOAD_LOG_MAX - 1);
    } catch {
      /* ignore */
    }
  }

  const isKnownEvent = EVENT_TYPE_TO_TOGGLE[eventNorm] !== undefined || EVENT_TYPE_TO_TOGGLE[eventType] !== undefined;
  if (!isKnownEvent) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Award leaderboard points and push overlay alerts for subs, gifts, kicks
  const getUsername = (obj: unknown) => ((obj as { username?: string })?.username ?? '').trim();
  let didAlertOrLeaderboard = false;
  if (eventNorm === 'channel.followed') {
    const follower = getUsername(payload.follower);
    if (follower) {
      await addFollowPoints(follower);
      didAlertOrLeaderboard = true;
    }
  } else if (eventNorm === 'channel.subscription.new') {
    const subscriber = payload.subscriber;
    if (subscriber) {
      await Promise.all([
        addSubPoints(getUsername(subscriber), false),
        addStreamGoalSubs(1),
        pushSubAlert(subscriber),
      ]);
      didAlertOrLeaderboard = true;
      const [goals, settings] = await Promise.all([
        getStreamGoals(),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      const target = (settings?.subGoalTarget as number) ?? 10;
      if (target > 0) await setGoalCelebrationIfNeeded('subs', goals.subs, target);
    }
  } else if (eventNorm === 'channel.subscription.renewal') {
    const subscriber = payload.subscriber;
    const duration = (payload.duration as number) ?? 0;
    if (subscriber) {
      await Promise.all([
        addSubPoints(getUsername(subscriber), true),
        addStreamGoalSubs(1),
        pushResubAlert(subscriber, duration > 0 ? duration : undefined),
      ]);
      didAlertOrLeaderboard = true;
      const [goals, settings] = await Promise.all([
        getStreamGoals(),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      const target = (settings?.subGoalTarget as number) ?? 10;
      if (target > 0) await setGoalCelebrationIfNeeded('subs', goals.subs, target);
    }
  } else if (eventNorm === 'channel.subscription.gifts') {
    const gifter = payload.gifter ?? (payload.data as Record<string, unknown>)?.gifter;
    const giftees = (payload.giftees as unknown[]) ?? [];
    const count = giftees.length > 0 ? giftees.length : 1;
    if (gifter) {
      await Promise.all([
        addGiftSubPoints(getUsername(gifter), count),
        addStreamGoalSubs(count),
        pushGiftSubAlert(gifter, count),
      ]);
      didAlertOrLeaderboard = true;
      const [goals, settings] = await Promise.all([
        getStreamGoals(),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      const target = (settings?.subGoalTarget as number) ?? 10;
      if (target > 0) await setGoalCelebrationIfNeeded('subs', goals.subs, target);
    }
  } else if (eventNorm === 'kicks.gifted') {
    const sender = payload.sender;
    const gift = payload.gift as { amount?: number; name?: string } | undefined;
    const amount = Number(gift?.amount ?? 0);
    const giftName = gift?.name as string | undefined;
    if (sender && amount > 0) {
      await Promise.all([
        addKicksPoints(getUsername(sender), amount),
        addStreamGoalKicks(amount),
        pushKicksAlert(sender, amount, giftName),
      ]);
      didAlertOrLeaderboard = true;
      const [goals, settings] = await Promise.all([
        getStreamGoals(),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      const target = (settings?.kicksGoalTarget as number) ?? 5000;
      if (target > 0) await setGoalCelebrationIfNeeded('kicks', goals.kicks, target);
    }
  }
  if (didAlertOrLeaderboard) {
    void broadcastAlertsAndLeaderboard();
  }

  if (isToggleDisabled(toggleKey, toggleValue)) {
    await pushDecision('skipped_toggle_off');
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
  if (eventNorm === 'channel.reward.redemption.updated') {
    const redemptionId = String(payload.id ?? '');
    const seenKey = redemptionId ? `${KICK_REWARD_SEEN_PREFIX}${redemptionId}` : null;
    const alreadySeen = !!seenKey && (await kv.get(seenKey));
    if (alreadySeen) {
      message = getChannelRewardResponse(payload, templates, { forceApproved: true }, templateEnabled);
    } else {
      message = await buildEventMessage(eventNorm, payload, buildOptions);
      if (message && seenKey) {
        try {
          await kv.set(seenKey, 1);
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    message = await buildEventMessage(eventNorm, payload, buildOptions);
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
