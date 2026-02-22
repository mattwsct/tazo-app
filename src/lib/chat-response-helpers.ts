/**
 * Shared chat command response helpers for Kick bot and Fossabot API.
 */

import { kv } from '@vercel/kv';
import { getSpeedStats, getAltitudeStats } from '@/utils/stats-storage';
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { fetchForecast, getWeatherEmoji } from '@/utils/weather-chat';
import { formatLocation } from '@/utils/location-utils';
import { roundCoordinate, getCountryNameFromCode } from '@/utils/chat-utils';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';

export async function getSpeedResponse(): Promise<string> {
  const stats = await getSpeedStats();
  if (!stats.hasData) return '🚀 Speed data not available';
  const parts: string[] = [];
  if (stats.current) {
    const currentText = stats.current.age === 'current'
      ? `${Math.round(stats.current.speed)} km/h`
      : `${Math.round(stats.current.speed)} km/h (${stats.current.age} ago)`;
    parts.push(`Current: ${currentText}`);
  } else parts.push('Current: Not available');
  if (stats.max) parts.push(`Max: ${Math.round(stats.max.speed)} km/h (${stats.max.age} ago)`);
  return `🚀 ${parts.join(' | ')}`;
}

export async function getAltitudeResponse(): Promise<string> {
  const stats = await getAltitudeStats();
  if (!stats.hasData) return '⛰️ Altitude data not available';
  const parts: string[] = [];
  if (stats.current) {
    const currentText = stats.current.age === 'current'
      ? `${stats.current.altitude} m`
      : `${stats.current.altitude} m (${stats.current.age} ago)`;
    parts.push(`Current: ${currentText}`);
  } else parts.push('Current: Not available');
  if (stats.lowest) parts.push(`Lowest: ${stats.lowest.altitude} m (${stats.lowest.age} ago)`);
  if (stats.highest) parts.push(`Highest: ${stats.highest.altitude} m (${stats.highest.age} ago)`);
  return `⛰️ ${parts.join(' | ')}`;
}

export async function getForecastResponse(): Promise<string> {
  const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
  if (!openweatherKey) return '🌤️ Forecast API not configured';

  const persistentLocation = await getPersistentLocation();
  const locationData = await getLocationData();
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

export async function getMapResponse(): Promise<string> {
  const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
  const displayMode = settings.locationDisplay;
  if (displayMode === 'hidden') return '🗺️ Map is hidden';

  const persistentLocation = await getPersistentLocation();
  const lat = persistentLocation?.rtirl?.lat ?? null;
  const lon = persistentLocation?.rtirl?.lon ?? null;

  if (persistentLocation?.location) {
    const rawLocation = persistentLocation.location;
    if (displayMode === 'custom') {
      if (rawLocation.countryCode) {
        const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
        if (countryName) {
          return `🗺️ https://www.google.com/maps?q=${encodeURIComponent(countryName)}`;
        }
      }
      return '🗺️ Map is hidden';
    }
    const formatted = formatLocation(rawLocation, displayMode);
    const parts: string[] = [];
    if (formatted.primary) parts.push(formatted.primary);
    if (formatted.secondary) parts.push(formatted.secondary);
    if (parts.length > 0) {
      const mapLocation = parts.join(', ');
      return `🗺️ https://www.google.com/maps?q=${encodeURIComponent(mapLocation)}`;
    }
  }

  if (lat != null && lon != null) {
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundCoordinate(lat)},${roundCoordinate(lon)}`)}`;
    return `🗺️ ${mapUrl}`;
  }
  return '🗺️ Map is hidden';
}
