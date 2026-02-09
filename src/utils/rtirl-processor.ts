/**
 * RTIRL payload processing utilities
 * Extracted from overlay page to reduce complexity
 */

import type { RTIRLPayload } from './overlay-constants';
import { extractAltitude } from './overlay-helpers';
import { distanceInMeters } from './location-utils';
import { TIMERS } from './overlay-constants';

export interface ProcessedGpsData {
  coords: [number, number];
  payloadTimestamp: number;
  now: number;
  isPayloadFresh: boolean;
  wasGpsDataStale: boolean;
  isFirstGpsUpdate: boolean;
  prevCoords: [number, number] | null;
  prevGpsTimestamp: number;
}

/**
 * Processes GPS data from RTIRL payload
 */
export function processGpsData(
  payload: RTIRLPayload,
  lastGpsUpdateTime: number,
  lastGpsTimestamp: number,
  lastCoords: [number, number] | null
): ProcessedGpsData | null {
  // Extract coordinates
  let lat: number | null = null;
  let lon: number | null = null;
  
  if (payload.location) {
    if ('lat' in payload.location && 'lon' in payload.location) {
      lat = payload.location.lat;
      lon = payload.location.lon;
    } else if ('latitude' in payload.location && 'longitude' in payload.location) {
      lat = (payload.location as { latitude: number }).latitude;
      lon = (payload.location as { longitude: number }).longitude;
    }
  }
  
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  
  const coords: [number, number] = [lat, lon];
  
  // Extract GPS timestamp
  const payloadWithTimestamp = payload as RTIRLPayload & { 
    timestamp?: number; 
    time?: number;
    reportedAt?: number;
    updatedAt?: number;
  };
  
  const payloadTimestamp = payloadWithTimestamp.reportedAt || 
                          payloadWithTimestamp.updatedAt || 
                          payloadWithTimestamp.timestamp || 
                          payloadWithTimestamp.time ||
                          Date.now();
  
  const now = Date.now();
  const timeSincePayload = now - payloadTimestamp;
  const isPayloadFresh = timeSincePayload <= TIMERS.GPS_FRESHNESS_TIMEOUT;
  
  // Check if GPS data was stale BEFORE this update
  const timeSinceLastGps = lastGpsUpdateTime > 0 ? (now - lastGpsUpdateTime) : Infinity;
  const wasGpsDataStale = timeSinceLastGps > TIMERS.GPS_STALE_TIMEOUT;
  const isFirstGpsUpdate = lastGpsUpdateTime === 0;
  
  return {
    coords,
    payloadTimestamp,
    now,
    isPayloadFresh,
    wasGpsDataStale,
    isFirstGpsUpdate,
    prevCoords: lastCoords,
    prevGpsTimestamp: lastGpsTimestamp,
  };
}

/**
 * Calculates speed from RTIRL payload and coordinates
 */
export function calculateSpeedFromPayload(
  payload: RTIRLPayload,
  lat: number,
  lon: number,
  prevCoords: [number, number] | null,
  prevGpsTimestamp: number,
  gpsUpdateTime: number,
  wasGpsDataStale: boolean
): number {
  if (wasGpsDataStale) return 0;
  
  // Try RTIRL speed first (preferred source)
  if (typeof payload === 'object' && payload !== null && 'speed' in payload) {
    const rawSpeedValue = (payload as RTIRLPayload).speed;
    if (typeof rawSpeedValue === 'number' && rawSpeedValue >= 0) {
      const rtirlSpeedKmh = rawSpeedValue * 3.6;
      
      // If RTIRL explicitly says speed = 0, trust it
      if (rtirlSpeedKmh === 0) {
        return 0;
      }
      
      // Check if coordinates contradict RTIRL speed (detect stale RTIRL speed)
      if (prevCoords && prevGpsTimestamp > 0) {
        const movedMeters = distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]);
        const timeDiffSeconds = (gpsUpdateTime - prevGpsTimestamp) / 1000;
        
        // If moved very little over reasonable time but RTIRL says moving, it's stale
        if (movedMeters < TIMERS.SPEED_STALE_DISTANCE_THRESHOLD && 
            timeDiffSeconds > TIMERS.SPEED_STALE_TIME_THRESHOLD && 
            rtirlSpeedKmh > 5) {
          return 0; // RTIRL speed is stale, coordinates show stationary
        }
      }
      
      return rtirlSpeedKmh;
    }
  }
  
  // Calculate from coordinates as fallback
  if (!prevCoords || prevGpsTimestamp <= 0) return 0;
  
  const movedMeters = distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]);
  const timeDiffSeconds = (gpsUpdateTime - prevGpsTimestamp) / 1000;
  const timeDiffHours = timeDiffSeconds / 3600;
  
  if (timeDiffHours > 0 && timeDiffSeconds >= TIMERS.MIN_TIME_SECONDS && movedMeters > 0) {
    return (movedMeters / 1000) / timeDiffHours;
  } else if (movedMeters === 0 && timeDiffSeconds > 0) {
    return 0;
  }
  
  return 0;
}

/**
 * Extracts and rounds altitude from payload
 */
export function processAltitude(payload: RTIRLPayload): number | null {
  const altitudeValue = extractAltitude(payload);
  return altitudeValue !== null ? Math.round(altitudeValue) : null;
}
