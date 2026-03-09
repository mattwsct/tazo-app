import { NextResponse } from 'next/server';
import { getWeatherEmoji, isNightTime } from '@/utils/weather-chat';
import { getLocationData } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { getCountryNameFromCode } from '@/utils/chat-utils';
import { jsonResponse, ChatContext } from './shared';

export async function handleStatusRoutes(route: string, q: string, ctx: ChatContext): Promise<NextResponse | null> {
  if (route !== 'status' && route !== 'homepage') return null;

  const { displayMode, persistentLocation, locationData } = ctx;

  const freshData = locationData || await getLocationData();

  let weatherData = null;
  if (freshData?.weather) {
    const { condition, desc, tempC, feelsLikeC, windKmh, humidity } = freshData.weather;
    weatherData = {
      emoji: getWeatherEmoji(condition, isNightTime()),
      condition: desc,
      tempC,
      tempF: Math.round(tempC * 9 / 5 + 32),
      feelsC: feelsLikeC,
      feelsF: Math.round(feelsLikeC * 9 / 5 + 32),
      wind: windKmh,
      humidity,
    };
  }

  const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
  let timeStr = null;
  if (timezone) {
    try {
      timeStr = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
    } catch {
      // Invalid timezone, skip
    }
  }

  let locationName: string | null = null;
  if (persistentLocation && persistentLocation.location) {
    const rawLocation = persistentLocation.location;
    if (displayMode !== 'hidden') {
      if (displayMode === 'custom') {
        if (rawLocation.countryCode) {
          locationName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
        }
      } else {
        const formatted = formatLocation(rawLocation, displayMode);
        const parts: string[] = [];
        if (formatted.primary) parts.push(formatted.primary);
        if (formatted.secondary) parts.push(formatted.secondary);
        if (parts.length > 0) {
          locationName = parts.join(', ');
        }
      }
    }
  }

  return jsonResponse({
    location: locationName,
    time: timeStr,
    timezone: timezone,
    weather: weatherData,
    forecast: freshData?.forecast || null,
  });
}
