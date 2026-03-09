import { NextResponse } from 'next/server';
import { getCountryNameFromCode, roundCoordinate } from '@/utils/chat-utils';
import { getLocationData } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { txtResponse, ChatContext } from './shared';

export async function handleLocationRoutes(route: string, q: string, ctx: ChatContext): Promise<NextResponse | null> {
  const { displayMode, persistentLocation, lat, lon, locationData } = ctx;

  if (route === 'location') {
    if (displayMode === 'hidden') {
      return txtResponse('Location is hidden');
    }

    if (persistentLocation && persistentLocation.location) {
      const rawLocation = persistentLocation.location;

      if (displayMode === 'custom') {
        if (rawLocation.countryCode) {
          const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
          return txtResponse(countryName || 'Location unavailable');
        }
        return txtResponse('Location is hidden');
      }

      const formatted = formatLocation(rawLocation, displayMode);
      const parts: string[] = [];
      if (formatted.primary && formatted.primary.trim()) parts.push(formatted.primary.trim());
      if (formatted.secondary && formatted.secondary.trim()) parts.push(formatted.secondary.trim());

      if (parts.length > 0) {
        return txtResponse(parts.join(', '));
      }

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
        return txtResponse(fallbackParts.join(', '));
      }
    }

    return txtResponse('Location unavailable');
  }

  if (route === 'map') {
    if (displayMode === 'hidden') {
      return txtResponse('Map is hidden');
    }

    if (persistentLocation && persistentLocation.location) {
      const rawLocation = persistentLocation.location;

      if (displayMode === 'custom') {
        if (rawLocation.countryCode) {
          const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
          if (countryName) {
            const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(countryName)}`;
            return txtResponse(mapUrl);
          }
        }
        return txtResponse('Map is hidden');
      }

      const formatted = formatLocation(rawLocation, displayMode);
      const parts: string[] = [];
      if (formatted.primary) parts.push(formatted.primary);
      if (formatted.secondary) parts.push(formatted.secondary);

      if (parts.length > 0) {
        const mapLocation = parts.join(', ');
        const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapLocation)}`;
        return txtResponse(mapUrl);
      }
    }

    if (lat !== null && lon !== null) {
      const roundedLat = roundCoordinate(lat);
      const roundedLon = roundCoordinate(lon);
      const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundedLat},${roundedLon}`)}`;
      return txtResponse(mapUrl);
    }

    return txtResponse('Map is hidden');
  }

  if (route === 'time') {
    const freshData = locationData || await getLocationData();
    const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
    if (!timezone) {
      return txtResponse('Time unavailable');
    }

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
    return txtResponse(`${timeStr} on ${dateStr} (${timezone})`);
  }

  return null;
}
