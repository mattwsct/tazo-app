/**
 * StreamElements tips integration via REST API polling.
 *
 * Vercel serverless functions cannot maintain persistent WebSocket connections,
 * so we poll the SE REST API from the cron job instead.
 *
 * Endpoint: GET https://api.streamelements.com/kappa/v2/tips/{channelId}
 * Auth:     Bearer {JWT}
 */

import { Logger } from '@/lib/logger';
import { kv } from '@/lib/kv';
import { pushDonationAlert } from '@/utils/overlay-alerts-storage';
import { addStreamGoalDonations, getStreamGoals } from '@/utils/stream-goals-storage';
import { bumpGoalTarget } from '@/utils/stream-goals-celebration';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import type { StreamElementsTipEvent } from '@/types/streamelements';

const seLogger = new Logger('STREAM-ELEMENTS');

const SE_API_BASE = 'https://api.streamelements.com/kappa/v2';
const LAST_TIP_TS_KEY = 'se_last_tip_timestamp';

function getJwt(): string | null {
  const token = process.env.STREAMELEMENTS_JWT;
  if (!token || !token.trim()) return null;
  return token.trim();
}

function getChannelIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return payload.channel ?? payload.channelId ?? payload.sub ?? null;
  } catch {
    return null;
  }
}

async function handleTipEvent(event: StreamElementsTipEvent): Promise<void> {
  const donation = event.donation;
  if (!donation) {
    seLogger.warn('Ignoring tip event with no donation payload', event);
    return;
  }

  const amount = donation.amount ?? 0;
  const currency = donation.currency ?? '';
  const username = donation.user?.username ?? 'Someone';

  if (!amount || !Number.isFinite(amount)) {
    seLogger.warn('Ignoring tip event with invalid amount', event);
    return;
  }

  const amountLabel = `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  const message = donation.message ?? '';

  const amountCents = Math.round(amount * 100);
  if (amountCents > 0) {
    try {
      await addStreamGoalDonations(amountCents);
      const [goals, settings] = await Promise.all([
        getStreamGoals(),
        kv.get<Record<string, unknown>>('overlay_settings'),
      ]);
      const target = (settings?.donationsGoalTargetCents as number) ?? 0;
      const increment = (settings?.donationsGoalIncrementCents as number) ?? 0;
      const hasSubtext = !!(settings?.donationsGoalSubtext as string | null | undefined);
      const showGoal = !!(settings?.showDonationsGoal);
      if (showGoal && !hasSubtext && increment > 0 && target > 0 && goals.donationsCents >= target) {
        await bumpGoalTarget('donations', target, increment, goals.donationsCents);
        seLogger.info('Donations goal bumped', { prev: target, count: goals.donationsCents, increment });
      }
    } catch (err) {
      seLogger.warn('Failed to process donation goal', err);
    }
  }

  await pushDonationAlert(username, amountLabel, message).catch((err) => {
    seLogger.warn('Failed to push donation alert', err);
  });

  const shortMsg = message.length > 80 ? `${message.slice(0, 77)}...` : message;
  const chatLine = shortMsg
    ? `${username} tipped ${amountLabel} via StreamElements: "${shortMsg}"`
    : `${username} tipped ${amountLabel} via StreamElements.`;

  try {
    const token = await getValidAccessToken();
    if (token) {
      await sendKickChatMessage(token, chatLine);
    }
  } catch (err) {
    seLogger.warn('Failed to send StreamElements tip to Kick chat', err);
  }

  seLogger.info('Processed tip', { id: event._id, username, amount, currency });
}

/**
 * Poll StreamElements REST API for new tips since last check.
 * Call from the cron job — safe for serverless.
 */
export async function pollStreamElementsTips(): Promise<void> {
  const jwt = getJwt();
  if (!jwt) return;

  const channelId = getChannelIdFromJwt(jwt);
  if (!channelId) {
    seLogger.warn('Could not extract channelId from JWT — check STREAMELEMENTS_JWT');
    return;
  }

  const lastTs = (await kv.get<string>(LAST_TIP_TS_KEY)) ?? null;

  try {
    const url = `${SE_API_BASE}/tips/${channelId}?sort=-createdAt&limit=10`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      seLogger.warn('SE tips API error', { status: res.status, body: body.slice(0, 200) });
      return;
    }

    const data = await res.json() as { docs?: StreamElementsTipEvent[] } | StreamElementsTipEvent[];
    const tips: StreamElementsTipEvent[] = Array.isArray(data) ? data : (data.docs ?? []);

    if (tips.length === 0) return;

    const newTips = lastTs
      ? tips.filter((t) => t.createdAt > lastTs)
      : [];

    if (lastTs === null) {
      seLogger.info('First poll — storing baseline timestamp, no tips processed', {
        latestTip: tips[0]?.createdAt,
        channelId,
      });
      await kv.set(LAST_TIP_TS_KEY, tips[0].createdAt);
      return;
    }

    if (newTips.length === 0) return;

    const sorted = newTips.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    seLogger.info(`Processing ${sorted.length} new tip(s)`);

    for (const tip of sorted) {
      await handleTipEvent(tip);
    }

    await kv.set(LAST_TIP_TS_KEY, sorted[sorted.length - 1].createdAt);
  } catch (err) {
    seLogger.warn('Failed to poll SE tips', err);
  }
}
