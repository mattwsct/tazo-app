/**
 * Shared chat command response helpers for Kick bot and Fossabot API.
 */

import { kv } from '@/lib/kv';
import { getSpeedStats, getAltitudeStats } from '@/utils/stats-storage';
import { getKickChannelStats } from '@/lib/kick-api';
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { fetchForecast, getWeatherEmoji } from '@/utils/weather-chat';
import { formatLocation } from '@/utils/location-utils';
import { roundCoordinate, getCountryNameFromCode } from '@/utils/chat-utils';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';
import { kmhToMph } from '@/utils/unit-conversions';

function fmtSpeed(kmh: number): string {
  return `${Math.round(kmh)} km/h (${Math.round(kmhToMph(kmh))} mph)`;
}

function fmtAltitude(m: number): string {
  return `${m} m (${Math.round(m * 3.281)} ft)`;
}

export async function getSpeedResponse(): Promise<string> {
  const stats = await getSpeedStats();
  if (!stats.hasData) return '🚀 No speed data yet — updates from GPS when moving.';
  const parts: string[] = [];
  if (stats.current) {
    const currentText = stats.current.age === 'current'
      ? fmtSpeed(stats.current.speed)
      : `${fmtSpeed(stats.current.speed)} (${stats.current.age} ago)`;
    parts.push(`Current: ${currentText}`);
  } else parts.push('Current: n/a');
  if (stats.max) parts.push(`Top: ${fmtSpeed(stats.max.speed)} (${stats.max.age} ago)`);
  return `🚀 ${parts.join(' | ')}`;
}

export async function getAltitudeResponse(): Promise<string> {
  const stats = await getAltitudeStats();
  if (!stats.hasData) return '⛰️ No altitude data yet — updates from GPS.';
  const parts: string[] = [];
  if (stats.current) {
    const currentText = stats.current.age === 'current'
      ? fmtAltitude(stats.current.altitude)
      : `${fmtAltitude(stats.current.altitude)} (${stats.current.age} ago)`;
    parts.push(`Current: ${currentText}`);
  } else parts.push('Current: n/a');
  if (stats.lowest) parts.push(`Low: ${fmtAltitude(stats.lowest.altitude)} (${stats.lowest.age} ago)`);
  if (stats.highest) parts.push(`High: ${fmtAltitude(stats.highest.altitude)} (${stats.highest.age} ago)`);
  return `⛰️ ${parts.join(' | ')}`;
}

export async function getForecastResponse(): Promise<string> {
  const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
  if (!openweatherKey) return '🌤️ Forecast API not configured';

  const [persistentLocation, locationData] = await Promise.all([getPersistentLocation(), getLocationData()]);
  const timezone = locationData?.timezone || persistentLocation?.location?.timezone || null;
  if (!timezone) return '🌤️ Timezone unavailable for forecast';

  const lat = persistentLocation?.rtirl?.lat ?? locationData?.rtirl?.lat ?? null;
  const lon = persistentLocation?.rtirl?.lon ?? locationData?.rtirl?.lon ?? null;
  if (lat == null || lon == null) return '🌤️ No location available for forecast';

  const fc = await fetchForecast(lat, lon, openweatherKey);
  if (!fc?.list?.length) return '🌤️ No forecast data available';

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: timezone });

  const dailyForecasts = new Map<string, typeof fc.list>();
  for (const item of fc.list) {
    if (!item?.dt || !item?.main?.temp) continue;
    const forecastTime = new Date(item.dt * 1000);
    const dateStr = forecastTime.toLocaleDateString('en-CA', { timeZone: timezone });
    if (!dailyForecasts.has(dateStr)) dailyForecasts.set(dateStr, []);
    dailyForecasts.get(dateStr)!.push(item);
  }

  const sortedDates = Array.from(dailyForecasts.keys()).sort();
  let todayIndex = sortedDates.findIndex((d) => d === todayStr);
  if (todayIndex === -1) todayIndex = 0;

  const out: string[] = [];
  let count = 0;
  for (let i = todayIndex; i < sortedDates.length && count < 5; i++) {
    const dateStr = sortedDates[i];
    const items = dailyForecasts.get(dateStr)!;
    let dateLabel: string;
    if (dateStr === todayStr) dateLabel = 'Today';
    else if (dateStr === tomorrowStr) dateLabel = 'Tomorrow';
    else {
      const firstItem = items[0];
      dateLabel = firstItem?.dt
        ? new Date(firstItem.dt * 1000).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: timezone,
          })
        : dateStr;
    }

    let minTempC = Infinity;
    let maxTempC = -Infinity;
    const conditions: string[] = [];
    let windSpeed = 0;
    let humidity = 0;
    for (const item of items) {
      if (item?.main?.temp != null) {
        const temp = Math.round(item.main.temp);
        if (temp < minTempC) minTempC = temp;
        if (temp > maxTempC) maxTempC = temp;
      }
      if (item?.weather?.[0]?.main && !conditions.includes(item.weather[0].main.toLowerCase())) {
        conditions.push(item.weather[0].main.toLowerCase());
      }
      if (item?.wind?.speed) windSpeed = Math.max(windSpeed, item.wind.speed * 3.6);
      if (item?.main?.humidity) humidity = Math.max(humidity, item.main.humidity);
    }
    if (minTempC === Infinity || maxTempC === -Infinity) continue;

    const condition = conditions[0] || '';
    const emoji = getWeatherEmoji(condition);
    const minTempF = Math.round(minTempC * 9 / 5 + 32);
    const maxTempF = Math.round(maxTempC * 9 / 5 + 32);
    const tempRange = minTempC === maxTempC
      ? `${minTempC}°C/${minTempF}°F`
      : `${minTempC}-${maxTempC}°C/${minTempF}-${maxTempF}°F`;

    const forecastParts = [`${emoji} ${dateLabel} ${tempRange}`];
    if (windSpeed > 20) forecastParts.push(`${Math.round(windSpeed)}km/h wind`);
    if (humidity > 80) forecastParts.push(`${humidity}% humidity`);
    out.push(forecastParts.join(' · '));
    count++;
  }
  return out.length > 0 ? `🌤️ ${out.join(' | ')}` : '🌤️ No forecast data available';
}

/**
 * Shared helper: resolves a persistent location and formats it as a display string.
 *
 * Pattern used by both chat-response-helpers (getMapResponse) and location-routes
 * (handleLocationRoutes). Returns an object so callers can branch on the result type.
 *
 * @returns
 *   - `{ type: 'hidden' }` — location is hidden or unavailable
 *   - `{ type: 'country', name: string }` — custom display mode, country-level only
 *   - `{ type: 'formatted', text: string }` — formatted primary/secondary string
 *   - `{ type: 'coords', lat: number, lon: number }` — coordinate fallback
 */
export async function resolveLocationForChat(
  displayMode: OverlaySettings['locationDisplay'],
  persistentLocation: Awaited<ReturnType<typeof getPersistentLocation>>,
  lat: number | null,
  lon: number | null,
): Promise<
  | { type: 'hidden' }
  | { type: 'country'; name: string }
  | { type: 'formatted'; text: string }
  | { type: 'coords'; lat: number; lon: number }
> {
  if (displayMode === 'hidden') return { type: 'hidden' };

  if (persistentLocation?.location) {
    const rawLocation = persistentLocation.location;

    if (displayMode === 'custom') {
      if (rawLocation.countryCode) {
        const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
        if (countryName) return { type: 'country', name: countryName };
      }
      return { type: 'hidden' };
    }

    const formatted = formatLocation(rawLocation, displayMode);
    const parts: string[] = [];
    if (formatted.primary && formatted.primary.trim()) parts.push(formatted.primary.trim());
    if (formatted.secondary && formatted.secondary.trim()) parts.push(formatted.secondary.trim());

    if (parts.length > 0) {
      return { type: 'formatted', text: parts.join(', ') };
    }

    // Fallback: try raw location fields
    const fallbackParts: string[] = [];
    if (rawLocation.city) fallbackParts.push(rawLocation.city);
    else if (rawLocation.town) fallbackParts.push(rawLocation.town);
    else if (rawLocation.municipality) fallbackParts.push(rawLocation.municipality);
    else if (rawLocation.suburb) fallbackParts.push(rawLocation.suburb);
    else if (rawLocation.state) fallbackParts.push(rawLocation.state);
    else if (rawLocation.province) fallbackParts.push(rawLocation.province);

    if (rawLocation.countryCode && fallbackParts.length > 0) {
      const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
      if (countryName) fallbackParts.push(countryName);
    }

    if (fallbackParts.length > 0) {
      return { type: 'formatted', text: fallbackParts.join(', ') };
    }
  }

  if (lat != null && lon != null) {
    return { type: 'coords', lat, lon };
  }

  return { type: 'hidden' };
}

export async function getMapResponse(): Promise<string> {
  const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
  const displayMode = settings.locationDisplay;

  const persistentLocation = await getPersistentLocation();
  const lat = persistentLocation?.rtirl?.lat ?? null;
  const lon = persistentLocation?.rtirl?.lon ?? null;

  const resolved = await resolveLocationForChat(displayMode, persistentLocation, lat, lon);
  switch (resolved.type) {
    case 'hidden':
      return '🗺️ Map is hidden';
    case 'country':
      return `🗺️ https://www.google.com/maps?q=${encodeURIComponent(resolved.name)}`;
    case 'formatted':
      return `🗺️ https://www.google.com/maps?q=${encodeURIComponent(resolved.text)}`;
    case 'coords': {
      const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundCoordinate(resolved.lat)},${roundCoordinate(resolved.lon)}`)}`;
      return `🗺️ ${mapUrl}`;
    }
  }
}

export async function getFollowersResponse(): Promise<string> {
  const stats = await getKickChannelStats();
  if (stats.followers == null) return '👥 Follower count unavailable.';
  const n = stats.followers.toLocaleString();
  const channel = stats.slug ? ` (kick.com/${stats.slug})` : '';
  return `👥 ${n} followers${channel}`;
}

export async function getSubsResponse(): Promise<string> {
  const stats = await getKickChannelStats();
  if (stats.subscribers == null) return '⭐ Subscriber count unavailable.';
  const n = stats.subscribers.toLocaleString();
  const channel = stats.slug ? ` (kick.com/${stats.slug})` : '';
  return `⭐ ${n} subscribers${channel}`;
}
