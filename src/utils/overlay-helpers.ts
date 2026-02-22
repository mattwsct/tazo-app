/**
 * Helper functions for overlay page
 */

import { OverlayLogger } from '@/lib/logger';
import type { RTIRLPayload } from './overlay-constants';
import type { OverlaySettings } from '@/types/settings';

/**
 * Check if timezone is valid (not null/undefined/UTC placeholder)
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
  return tz !== null && tz !== undefined && tz !== 'UTC';
}

/**
 * Clear timeout safely from a ref
 */
export function clearTimer(timerRef: React.MutableRefObject<NodeJS.Timeout | null>): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

/**
 * Safe API call wrapper that catches and logs errors
 */
export async function safeApiCall(
  apiCall: () => Promise<unknown>,
  context: string
): Promise<unknown> {
  try {
    return await apiCall();
  } catch (error) {
    OverlayLogger.error(`${context} failed`, error);
    return null;
  }
}

/**
 * Format time/date using specified timezone (default UTC)
 */
export function formatTimeWithTimezone(timezone: string = 'UTC'): { time: string; date: string } {
  const now = new Date();
  return {
    time: now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }),
    date: now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    }),
  };
}

/**
 * Extract altitude from RTIRL payload
 * RTIRL provides altitude as either a number or an object with EGM96/WGS84
 */
export function extractAltitude(payload: RTIRLPayload): number | null {
  if (payload.altitude === undefined) return null;

  if (typeof payload.altitude === 'number' && payload.altitude >= 0) {
    return payload.altitude;
  }

  if (typeof payload.altitude === 'object' && payload.altitude !== null) {
    const altitudeObj = payload.altitude as { EGM96?: number; WGS84?: number };
    // Prefer EGM96 (more accurate for elevation above sea level), fallback to WGS84
    if (altitudeObj.EGM96 !== undefined && typeof altitudeObj.EGM96 === 'number' && altitudeObj.EGM96 >= 0) {
      return altitudeObj.EGM96;
    }
    if (altitudeObj.WGS84 !== undefined && typeof altitudeObj.WGS84 === 'number' && altitudeObj.WGS84 >= 0) {
      return altitudeObj.WGS84;
    }
  }

  return null;
}

const HASH_EXCLUDE = new Set(['leaderboardTop', 'gamblingLeaderboardTop', 'overlayAlerts', 'pollState']);

/**
 * Create a stable hash from settings (sorts keys for consistency)
 * Excludes runtime-only fields that change frequently
 */
export function createSettingsHash(settings: OverlaySettings): string {
  const sorted = Object.keys(settings)
    .filter((k) => !HASH_EXCLUDE.has(k))
    .sort()
    .reduce((acc, key) => {
      acc[key] = settings[key as keyof OverlaySettings];
      return acc;
    }, {} as Record<string, unknown>);
  return JSON.stringify(sorted);
}
