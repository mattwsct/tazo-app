import { Logger } from '@/lib/logger';
import { pushDonationAlert } from '@/utils/overlay-alerts-storage';
import { addStreamGoalDonations } from '@/utils/stream-goals-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import type { StreamElementsTipEvent } from '@/types/streamelements';

const seLogger = new Logger('STREAM-ELEMENTS');

const STREAM_ELEMENTS_WS_URL = 'wss://realtime.streamelements.com';

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
  const amount = event.data?.amount ?? 0;
  const currency = event.data?.currency ?? '';
  const username = event.data?.username ?? 'Someone';
  if (!amount || !Number.isFinite(amount)) {
    seLogger.warn('Ignoring tip event with invalid amount', event);
    return;
  }
  const amountLabel = `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  const message = event.data?.message ?? '';
  // Persist donation goal in cents if we can infer a conversion (assume base currency unit → cents).
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
    seLogger.info('Connecting to StreamElements real-time API...');
    socket = new WebSocket(STREAM_ELEMENTS_WS_URL);

    socket.onopen = () => {
      reconnectAttempts = 0;
      seLogger.info('StreamElements WebSocket connected, authenticating...');
      const authPayload = {
        type: 'authenticate',
        data: { token: jwt },
      };
      socket?.send(JSON.stringify(authPayload));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; event?: string; data?: unknown };
        if (msg.type === 'authenticated') {
          seLogger.info('StreamElements authentication succeeded');
          return;
        }
        if (msg.type === 'unauthorized') {
          seLogger.error('StreamElements authentication failed; disabling client');
          socket?.close();
          socket = null;
          return;
        }
        if (msg.type === 'event' && msg.event === 'tip' && msg.data) {
          const tipEvent = msg.data as StreamElementsTipEvent;
          handleTipEvent(tipEvent);
        }
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

// Initialize connection when this module is first imported.
if (typeof WebSocket !== 'undefined') {
  connect();
} else {
  seLogger.warn('Global WebSocket is not available; StreamElements client not started');
}

export function ensureStreamElementsClient(): void {
  connect();
}

