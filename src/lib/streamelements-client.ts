import { Logger } from '@/lib/logger';
import { pushDonationAlert } from '@/utils/overlay-alerts-storage';
import { addStreamGoalDonations } from '@/utils/stream-goals-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import type { StreamElementsTipEvent } from '@/types/streamelements';

const seLogger = new Logger('STREAM-ELEMENTS');

const ASTRO_WS_URL = 'wss://astro.streamelements.com';
const SUBSCRIBE_TOPIC = 'channel.tips';

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

function getJwt(): string | null {
  const token = process.env.STREAMELEMENTS_JWT;
  if (!token || !token.trim()) return null;
  return token.trim();
}

function scheduleReconnect(): void {
  const jwt = getJwt();
  if (!jwt) {
    seLogger.warn('Skipping reconnect: STREAMELEMENTS_JWT not configured');
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(30_000, 1000 * 2 ** (reconnectAttempts - 1));
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    connect();
  }, delay);
  seLogger.info(`Scheduled reconnect in ${delay}ms`, { attempt: reconnectAttempts });
}

function handleTipEvent(event: StreamElementsTipEvent): void {
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
    void addStreamGoalDonations(amountCents).catch((err) => {
      seLogger.warn('Failed to increment donation goals', err);
    });
  }

  void pushDonationAlert(username, amountLabel, message).catch((err) => {
    seLogger.warn('Failed to push donation alert', err);
  });

  {
    const shortMsg = message.length > 80 ? `${message.slice(0, 77)}...` : message;
    const chatLine = shortMsg
      ? `${username} tipped ${amountLabel} via StreamElements: "${shortMsg}"`
      : `${username} tipped ${amountLabel} via StreamElements.`;

    void (async () => {
      try {
        const token = await getValidAccessToken();
        if (token) {
          await sendKickChatMessage(token, chatLine);
        }
      } catch (err) {
        seLogger.warn('Failed to send StreamElements tip to Kick chat', err);
      }
    })();
  }

  seLogger.info('Received tip event', {
    id: event._id,
    username,
    amount,
    currency,
  });
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const jwt = getJwt();
  if (!jwt) {
    seLogger.warn('StreamElements client disabled: STREAMELEMENTS_JWT is not set');
    return;
  }
  try {
    seLogger.info('Connecting to StreamElements Astro gateway...');
    socket = new WebSocket(ASTRO_WS_URL);

    socket.onopen = () => {
      reconnectAttempts = 0;
      seLogger.info('StreamElements WebSocket connected, subscribing to channel.tips...');

      const nonce = `se-sub-${Date.now()}`;
      const subscribePayload = {
        type: 'subscribe',
        nonce,
        data: {
          topic: SUBSCRIBE_TOPIC,
          token: jwt,
          token_type: 'jwt',
        },
      };
      socket?.send(JSON.stringify(subscribePayload));
    };

    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type?: string;
          topic?: string;
          nonce?: string;
          error?: string;
          data?: unknown;
        };

        if (msg.type === 'response') {
          if (msg.error) {
            seLogger.error('StreamElements subscription error', { error: msg.error, nonce: msg.nonce, data: msg.data });
            if (msg.error === 'err_unauthorized') {
              seLogger.error('JWT is invalid or expired — check STREAMELEMENTS_JWT. Closing connection.');
              socket?.close();
              socket = null;
              return;
            }
          } else {
            seLogger.info('StreamElements subscription confirmed', { nonce: msg.nonce, data: msg.data });
          }
          return;
        }

        if (msg.type === 'message' && typeof msg.topic === 'string' && msg.topic.startsWith('channel.tips')) {
          const tipEvent = msg.data as StreamElementsTipEvent;
          if (tipEvent && tipEvent.donation) {
            handleTipEvent(tipEvent);
          } else {
            seLogger.warn('Received channel.tips message with unexpected data shape', msg.data);
          }
          return;
        }

        seLogger.info('StreamElements message', { type: msg.type, topic: msg.topic });
      } catch (err) {
        seLogger.warn('Failed to parse StreamElements message', err);
      }
    };

    socket.onerror = (err) => {
      seLogger.error('StreamElements WebSocket error', err);
    };

    socket.onclose = () => {
      seLogger.warn('StreamElements WebSocket closed; scheduling reconnect');
      socket = null;
      scheduleReconnect();
    };
  } catch (err) {
    seLogger.error('Failed to open StreamElements WebSocket', err);
    scheduleReconnect();
  }
}

if (typeof WebSocket !== 'undefined') {
  connect();
} else {
  seLogger.warn('Global WebSocket is not available; StreamElements client not started');
}

export function ensureStreamElementsClient(): void {
  connect();
}
