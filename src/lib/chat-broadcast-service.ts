import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { getLocationData } from '@/utils/location-cache';
import { getStreamState } from '@/utils/stats-storage';
import { loadKickAlertSettings } from '@/lib/kick-alert-settings';
import { getBroadcastState, setBroadcastState } from '@/lib/kick-broadcast-state';
import {
  isNotableWeatherCondition,
  getWeatherEmoji,
  formatTemperature,
  isNightTime,
  isHighUV,
  isPoorAirQuality,
} from '@/utils/weather-chat';
import { checkStatsBroadcastsAndSendChat, StatsBroadcastSource, StatsBroadcastCurrent } from '@/lib/stats-broadcast-chat';
import { checkWellnessMilestonesAndSendChat } from '@/lib/wellness-milestone-chat';

export type SystemMessageKind =
  | 'heist_resolve'
  | 'raffle_resolve'
  | 'boss_event'
  | 'poll_start'
  | 'top_chatter'
  | 'auto_game_start'
  | 'tazo_drop_resolve'
  | 'boss_resolve'
  | 'boss_reminder';

export async function maybeBroadcastStats(
  current: StatsBroadcastCurrent,
  source: StatsBroadcastSource,
): Promise<number> {
  return checkStatsBroadcastsAndSendChat({ current, source });
}

export async function maybeBroadcastWellness(): Promise<number> {
  return checkWellnessMilestonesAndSendChat();
}

export async function maybeBroadcastWeather(): Promise<number> {
  const [token, streamState, alertSettings] = await Promise.all([
    getValidAccessToken(),
    getStreamState(),
    loadKickAlertSettings(),
  ]);

  if (!token) {
    console.log('[ChatBroadcast] Weather skip: no Kick token');
    return 0;
  }
  if (!streamState.isLive) {
    console.log('[ChatBroadcast] Weather skip: stream not live');
    return 0;
  }

  const chatBroadcastWeather = alertSettings.chatBroadcastWeather === true;
  if (!chatBroadcastWeather) return 0;

  let locationData: Awaited<ReturnType<typeof getLocationData>> | null = null;
  try {
    locationData = await getLocationData(false);
  } catch {
    return 0;
  }

  if (!locationData?.weather) return 0;

  const state = await getBroadcastState();

  const { condition, desc, tempC, uvIndex, aqi } = locationData.weather;
  const condKey = `${condition}|${desc}|uv:${uvIndex ?? 'n'}|aqi:${aqi ?? 'n'}`;
  const lastCond = state.weather?.lastCondKey ?? null;

  const weatherNotable = isNotableWeatherCondition(desc);
  const uvNotable = isHighUV(uvIndex);
  const aqiNotable = isPoorAirQuality(aqi);
  const isNotable = weatherNotable || uvNotable || aqiNotable;
  const isNewNotableChange = isNotable && condKey !== lastCond;

  if (!isNewNotableChange) return 0;

  const parts: string[] = [];
  if (weatherNotable) {
    const emoji = getWeatherEmoji(condition, isNightTime());
    parts.push(`${emoji} ${desc}`);
  }
  if (uvNotable) parts.push(`high UV (${uvIndex})`);
  if (aqiNotable) parts.push(`poor air quality (AQI ${aqi})`);
  const mainPart = parts.length > 0 ? parts.join(', ') : 'conditions';
  const msg = `🌤️ Weather update: ${mainPart}, ${formatTemperature(tempC)}`;

  try {
    await sendKickChatMessage(token, msg);
    await setBroadcastState({ weather: { lastCondKey: condKey } });
    console.log('[ChatBroadcast] CHAT_SENT', JSON.stringify({ type: 'weather', cond: desc, uv: uvIndex, aqi }));
    return 1;
  } catch (err) {
    console.error(
      '[ChatBroadcast] CHAT_FAIL',
      JSON.stringify({ type: 'weather', error: err instanceof Error ? err.message : String(err) }),
    );
    return 0;
  }
}

export async function sendSystemMessage(kind: SystemMessageKind, message: string): Promise<boolean> {
  const token = await getValidAccessToken();
  if (!token) {
    console.log('[ChatBroadcast] SystemMessage skip: no Kick token', JSON.stringify({ kind }));
    return false;
  }
  try {
    await sendKickChatMessage(token, message);
    console.log('[ChatBroadcast] SYSTEM_CHAT_SENT', JSON.stringify({ kind, msgPreview: message.slice(0, 80) }));
    return true;
  } catch (err) {
    console.error(
      '[ChatBroadcast] SYSTEM_CHAT_FAIL',
      JSON.stringify({ kind, error: err instanceof Error ? err.message : String(err) }),
    );
    return false;
  }
}

