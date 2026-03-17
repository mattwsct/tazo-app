import { NextResponse } from 'next/server';
import { roundCoordinate } from '@/utils/chat-utils';
import { getLocationData } from '@/utils/location-cache';
import { resolveLocationForChat } from '@/lib/chat-response-helpers';
import { txtResponse, ChatContext } from './shared';

export async function handleLocationRoutes(route: string, q: string, ctx: ChatContext): Promise<NextResponse | null> {
  const { displayMode, persistentLocation, lat, lon, locationData } = ctx;

  if (route === 'location') {
    const resolved = await resolveLocationForChat(displayMode, persistentLocation, lat, lon);
    switch (resolved.type) {
      case 'hidden':
        return txtResponse('Location is hidden');
      case 'country':
        return txtResponse(resolved.name);
      case 'formatted':
        return txtResponse(resolved.text);
      case 'coords':
        // Coordinates fall back to unavailable for the !location command (no reverse geocode here)
        return txtResponse('Location unavailable');
    }
  }

  if (route === 'map') {
    const resolved = await resolveLocationForChat(displayMode, persistentLocation, lat, lon);
    switch (resolved.type) {
      case 'hidden':
        return txtResponse('Map is hidden');
      case 'country':
        return txtResponse(`https://www.google.com/maps?q=${encodeURIComponent(resolved.name)}`);
      case 'formatted':
        return txtResponse(`https://www.google.com/maps?q=${encodeURIComponent(resolved.text)}`);
      case 'coords': {
        const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundCoordinate(resolved.lat)},${roundCoordinate(resolved.lon)}`)}`;
        return txtResponse(mapUrl);
      }
    }
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
