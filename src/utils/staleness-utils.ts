/**
 * Staleness check utilities
 * Unified staleness detection for GPS data
 */

import { TIMERS } from './overlay-constants';

/**
 * Checks if GPS data is stale based on timestamp
 */
export function isGpsStale(
  gpsTimestamp: number,
  now: number = Date.now(),
  staleTimeout: number = TIMERS.GPS_STALE_TIMEOUT
): boolean {
  if (gpsTimestamp <= 0) return true;
  const timeSinceUpdate = now - gpsTimestamp;
  return timeSinceUpdate > staleTimeout;
}

/**
 * Checks if altitude data is stale
 */
export function isAltitudeStale(
  altitudeGpsTimestamp: number,
  now: number = Date.now()
): boolean {
  return isGpsStale(altitudeGpsTimestamp, now, TIMERS.ONE_MINUTE);
}

/**
 * Checks if speed data is stale
 */
export function isSpeedStale(
  speedGpsTimestamp: number,
  now: number = Date.now()
): boolean {
  return isGpsStale(speedGpsTimestamp, now, TIMERS.GPS_STALE_TIMEOUT);
}

/**
 * Gets time since last update in milliseconds
 */
export function getTimeSinceUpdate(
  lastUpdateTimestamp: number,
  now: number = Date.now()
): number {
  if (lastUpdateTimestamp <= 0) return Infinity;
  return now - lastUpdateTimestamp;
}
