import { kv } from '@/lib/kv';

export const KICK_BROADCAST_STATE_KEY = 'kick_broadcast_state';

export interface KickBroadcastState {
  heartrate?: {
    state: 'below' | 'high' | 'very_high';
    lastSentAt?: number;
  };
  speed?: {
    lastSentAt?: number;
    lastAnnouncedTop?: number;
  };
  altitude?: {
    lastSentAt?: number;
    lastAnnouncedTop?: number;
  };
  weather?: {
    lastCondKey?: string;
  };
  wellness?: {
    lastSteps?: number;
    lastDistanceKm?: number;
    lastActiveCalories?: number;
  };
}

export async function getBroadcastState(): Promise<KickBroadcastState> {
  const state = await kv.get<KickBroadcastState>(KICK_BROADCAST_STATE_KEY);
  return state ?? {};
}

export async function setBroadcastState(patch: Partial<KickBroadcastState>): Promise<void> {
  const current = await getBroadcastState();
  const next: KickBroadcastState = {
    ...current,
    heartrate: patch.heartrate
      ? { ...(current.heartrate ?? {}), ...patch.heartrate }
      : current.heartrate,
    speed: patch.speed
      ? { ...(current.speed ?? {}), ...patch.speed }
      : current.speed,
    altitude: patch.altitude
      ? { ...(current.altitude ?? {}), ...patch.altitude }
      : current.altitude,
    weather: patch.weather
      ? { ...(current.weather ?? {}), ...patch.weather }
      : current.weather,
    wellness: patch.wellness
      ? { ...(current.wellness ?? {}), ...patch.wellness }
      : current.wellness,
  };
  await kv.set(KICK_BROADCAST_STATE_KEY, next);
}

