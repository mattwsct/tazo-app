/**
 * Kick chat command handlers. Responds to !test, !location, !weather, !time in Kick chat.
 * Reuses the same data sources as the overlay and Fossabot chat commands.
 */

import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { getCountryNameFromCode } from '@/utils/chat-utils';
import {
  getWeatherEmoji,
  isNightTime,
  formatTemperature,
  getNotableConditions,
} from '@/utils/weather-chat';
import { kv } from '@vercel/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';
import type { LocationDisplayMode } from '@/types/settings';

export const KICK_CHAT_COMMANDS = ['test', 'location', 'loc', 'weather', 'time'] as const;
export type KickChatCommand = (typeof KICK_CHAT_COMMANDS)[number];

function parseCommand(content: string): { cmd: KickChatCommand; args: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return null;
  const rest = trimmed.slice(1).trim();
  const spaceIdx = rest.indexOf(' ');
  const cmd = (spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest).toLowerCase();
  const args = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : '';
  if (!KICK_CHAT_COMMANDS.includes(cmd as KickChatCommand)) return null;
  return { cmd: cmd as KickChatCommand, args };
}

export function parseKickChatMessage(content: string): { cmd: KickChatCommand; args: string } | null {
  return parseCommand(content);
}

export async function handleKickChatCommand(
  cmd: KickChatCommand,
  _args: string
): Promise<string | null> {
  const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
  const displayMode = settings.locationDisplay;
  const persistentLocation = await getPersistentLocation();

  // location / test / loc - same as !location
  if (cmd === 'test' || cmd === 'location' || cmd === 'loc') {
    if (displayMode === 'hidden') return 'Location is hidden';
    if (!persistentLocation?.location) return 'Location unavailable';

    const rawLocation = persistentLocation.location;
    if (displayMode === 'custom') {
      if (rawLocation.countryCode) {
        const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
        return countryName || 'Location unavailable';
      }
      return 'Location is hidden';
    }

    const formatted = formatLocation(rawLocation, displayMode as LocationDisplayMode);
    const parts: string[] = [];
    if (formatted.primary?.trim()) parts.push(formatted.primary.trim());
    if (formatted.secondary?.trim()) parts.push(formatted.secondary.trim());
    if (parts.length > 0) return parts.join(', ');

    const fallbackParts: string[] = [];
    if (rawLocation.neighbourhood) fallbackParts.push(rawLocation.neighbourhood);
    else if (rawLocation.suburb) fallbackParts.push(rawLocation.suburb);
    else if (rawLocation.city) fallbackParts.push(rawLocation.city);
    else if (rawLocation.town) fallbackParts.push(rawLocation.town);
    else if (rawLocation.state) fallbackParts.push(rawLocation.state);
    if (rawLocation.countryCode && fallbackParts.length > 0) {
      const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
      if (countryName) fallbackParts.push(countryName);
    }
    return fallbackParts.length > 0 ? fallbackParts.join(', ') : 'Location unavailable';
  }

  // weather
  if (cmd === 'weather') {
    const freshData = await getLocationData();
    if (!freshData?.weather) return 'Weather data unavailable';

    const { condition, desc, tempC, feelsLikeC, windKmh, humidity, visibility } = freshData.weather;
    const emoji = getWeatherEmoji(condition, isNightTime());
    const notableConditions = getNotableConditions({
      tempC,
      feelsLikeC,
      windKmh,
      humidity,
      visibility,
    });
    const feelsF = Math.round(feelsLikeC * 9 / 5 + 32);
    const parts: string[] = [`${emoji} ${formatTemperature(tempC)} ${desc}`];
    if (Math.abs(feelsLikeC - tempC) > 1) {
      parts.push(`feels like ${formatTemperature(feelsLikeC)}`);
    }
    if (notableConditions.length > 0) parts.push(notableConditions.join(', '));
    return parts.join(' · ');
  }

  // time
  if (cmd === 'time') {
    const freshData = await getLocationData();
    const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
    if (!timezone) return 'Time unavailable';

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    });
    return `${timeStr} on ${dateStr} (${timezone})`;
  }

  return null;
}
