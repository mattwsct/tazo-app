import { io, Socket } from 'socket.io-client';
import { Logger } from '@/lib/logger';
import { pushDonationAlert } from '@/utils/overlay-alerts-storage';
import { addStreamGoalDonations } from '@/utils/stream-goals-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import type { StreamElementsTipEvent } from '@/types/streamelements';

const seLogger = new Logger('STREAM-ELEMENTS');

const SE_REALTIME_URL = 'https://realtime.streamelements.com';

let socket: Socket | null = null;

function getJwt(): string | null {
  const token = process.env.STREAMELEMENTS_JWT;
  if (!token || !token.trim()) return null;
  return token.trim();
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
  if (socket?.connected) return;

  const jwt = getJwt();
  if (!jwt) {
    seLogger.warn('StreamElements client disabled: STREAMELEMENTS_JWT is not set');
    return;
  }

  seLogger.info('Connecting to StreamElements realtime...');

  socket = io(SE_REALTIME_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
  });

  socket.on('connect', () => {
    seLogger.info('Connected; authenticating with JWT...');
    socket!.emit('authenticate', { method: 'jwt', token: jwt });
  });

  socket.on('authenticated', (data: unknown) => {
    seLogger.info('StreamElements authenticated', data);
  });

  socket.on('unauthorized', (err: unknown) => {
    seLogger.error('StreamElements authentication failed — check STREAMELEMENTS_JWT', err);
    socket?.disconnect();
    socket = null;
  });

  socket.on('tip', (data: StreamElementsTipEvent) => {
    handleTipEvent(data);
  });

  socket.on('disconnect', (reason: string) => {
    seLogger.warn('StreamElements disconnected', { reason });
  });

  socket.on('connect_error', (err: Error) => {
    seLogger.error('StreamElements connection error', { message: err.message });
  });
}

connect();

export function ensureStreamElementsClient(): void {
  connect();
}
