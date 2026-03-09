import { NextResponse } from 'next/server';
import { getSpeedStats, getAltitudeStats, isStreamLive } from '@/utils/stats-storage';
import { getFollowersResponse, getSubsResponse } from '@/lib/chat-response-helpers';
import { txtResponse } from './shared';

export const STREAM_GATED_ROUTES = new Set([
  'location', 'weather', 'uv', 'aqi', 'forecast', 'map',
  'heartrate', 'hr', 'speed', 'altitude', 'elevation',
  'steps', 'distance', 'dist', 'wellness',
]);

const STREAM_OFFLINE_MSG = "Stream is offline — stats and location are hidden until we're live.";

export async function handleStatsRoutes(route: string): Promise<NextResponse | null> {
  // First, check stream-gated routes (covers both stats and location routes)
  if (STREAM_GATED_ROUTES.has(route) && !(await isStreamLive())) {
    return txtResponse(STREAM_OFFLINE_MSG);
  }

  if (route === 'heartrate' || route === 'hr') {
    const { getHeartrateStats } = await import('@/utils/stats-storage');
    const stats = await getHeartrateStats();
    if (stats.hasData) {
      const parts: string[] = [];
      if (stats.current) {
        const curr = stats.current.age === 'current' ? `${stats.current.bpm} bpm (live)` : `${stats.current.bpm} bpm (${stats.current.age} ago)`;
        parts.push(`Current: ${curr}`);
      }
      if (stats.min) parts.push(`Low: ${stats.min.bpm} bpm`);
      if (stats.max) parts.push(`High: ${stats.max.bpm} bpm`);
      return txtResponse(`💓 ${parts.join(' | ')}`);
    }
    return txtResponse('💓 No heart rate data this stream yet. (Pulsoid on overlay)');
  }

  if (route === 'speed') {
    const stats = await getSpeedStats();

    if (!stats.hasData) {
      return txtResponse('Speed data not available');
    }

    const parts: string[] = [];

    if (stats.current) {
      const currentText = stats.current.age === 'current'
        ? `${Math.round(stats.current.speed)} km/h`
        : `${Math.round(stats.current.speed)} km/h (${stats.current.age} ago)`;
      parts.push(`Current: ${currentText}`);
    } else {
      parts.push('Current: Not available');
    }

    if (stats.max) {
      parts.push(`Max: ${Math.round(stats.max.speed)} km/h (${stats.max.age} ago)`);
    }

    return txtResponse(parts.join(' | '));
  }

  if (route === 'altitude' || route === 'elevation') {
    const stats = await getAltitudeStats();

    if (!stats.hasData) {
      return txtResponse('Altitude data not available');
    }

    const parts: string[] = [];

    if (stats.current) {
      const currentText = stats.current.age === 'current'
        ? `${stats.current.altitude} m`
        : `${stats.current.altitude} m (${stats.current.age} ago)`;
      parts.push(`Current: ${currentText}`);
    } else {
      parts.push('Current: Not available');
    }

    if (stats.lowest) {
      parts.push(`Lowest: ${stats.lowest.altitude} m (${stats.lowest.age} ago)`);
    }

    if (stats.highest) {
      parts.push(`Highest: ${stats.highest.altitude} m (${stats.highest.age} ago)`);
    }

    return txtResponse(parts.join(' | '));
  }

  if (route === 'followers') return txtResponse(await getFollowersResponse());
  if (route === 'subs' || route === 'subscribers') return txtResponse(await getSubsResponse());

  // Wellness routes
  if (route === 'steps' || route === 'distance' || route === 'dist' || route === 'wellness') {
    const {
      getWellnessStepsResponse,
      getWellnessDistanceResponse,
      getWellnessSummaryResponse,
    } = await import('@/utils/wellness-chat');

    if (route === 'steps') return txtResponse(await getWellnessStepsResponse());
    if (route === 'distance' || route === 'dist') return txtResponse(await getWellnessDistanceResponse());
    if (route === 'wellness') return txtResponse(await getWellnessSummaryResponse());
  }

  return null;
}
