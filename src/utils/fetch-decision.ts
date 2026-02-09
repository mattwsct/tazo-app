/**
 * Fetch decision utilities for weather and location
 * Consolidates complex fetch logic from overlay page
 */

import { TIMERS } from './overlay-constants';
import { distanceInMeters } from './location-utils';
import { isValidTimezone } from './overlay-helpers';

export interface FetchDecisionParams {
  now: number;
  lastFetchTime: number;
  lastSuccessfulFetch: number;
  movedMeters: number;
  prevCoords: [number, number] | null;
  currentCoords: [number, number];
  currentSpeed: number;
  needsTimezone: boolean;
}

export interface WeatherFetchDecision {
  shouldFetch: boolean;
  reason: string;
}

export interface LocationFetchDecision {
  shouldFetch: boolean;
  reason: string;
  adaptiveThreshold: number;
}

/**
 * Determines if weather should be fetched
 */
export function shouldFetchWeather(params: FetchDecisionParams): WeatherFetchDecision {
  const {
    now,
    lastFetchTime,
    lastSuccessfulFetch,
    movedMeters,
    currentCoords,
    prevCoords,
    needsTimezone,
  } = params;
  
  // Detect dramatic coordinate changes (e.g., jumping continents)
  const isDramaticChange = prevCoords 
    ? movedMeters > TIMERS.DRAMATIC_CHANGE_THRESHOLD 
    : false;
  
  const weatherElapsed = now - lastFetchTime;
  const hasWeatherData = lastSuccessfulFetch > 0;
  const weatherDataAge = hasWeatherData ? now - lastSuccessfulFetch : Infinity;
  
  const shouldFetch = isDramaticChange ||
    lastFetchTime === 0 ||
    weatherElapsed >= TIMERS.WEATHER_UPDATE_INTERVAL ||
    !hasWeatherData ||
    weatherDataAge >= TIMERS.WEATHER_DATA_VALIDITY_TIMEOUT ||
    needsTimezone;
  
  let reason = 'not needed';
  if (isDramaticChange) reason = 'dramatic change';
  else if (lastFetchTime === 0) reason = 'first fetch';
  else if (weatherElapsed >= TIMERS.WEATHER_UPDATE_INTERVAL) reason = 'interval elapsed';
  else if (!hasWeatherData) reason = 'no data';
  else if (weatherDataAge >= TIMERS.WEATHER_DATA_VALIDITY_TIMEOUT) reason = 'data stale';
  else if (needsTimezone) reason = 'timezone needed';
  
  return { shouldFetch, reason };
}

/**
 * Determines if location should be fetched
 */
export function shouldFetchLocation(params: FetchDecisionParams): LocationFetchDecision {
  const {
    now,
    lastFetchTime,
    movedMeters,
    currentSpeed,
    prevCoords,
  } = params;
  
  // Detect dramatic coordinate changes
  const isDramaticChange = prevCoords 
    ? movedMeters > TIMERS.DRAMATIC_CHANGE_THRESHOLD 
    : false;
  
  // Adaptive location update threshold based on speed
  const adaptiveThreshold = currentSpeed > 200 
    ? 1000  // 1km threshold for flights (>200 km/h)
    : currentSpeed > 50 
      ? 100  // 100m threshold for driving (50-200 km/h)
      : 10;  // 10m threshold for walking (<50 km/h)
  
  const locationElapsed = now - lastFetchTime;
  const meetsDistance = movedMeters >= adaptiveThreshold;
  
  const LOCATION_MIN_INTERVAL = 18000; // 18 seconds minimum
  const shouldFetch = isDramaticChange ||
    lastFetchTime === 0 ||
    (locationElapsed >= LOCATION_MIN_INTERVAL && meetsDistance);
  
  let reason = 'not needed';
  if (isDramaticChange) reason = 'dramatic change';
  else if (lastFetchTime === 0) reason = 'first fetch';
  else if (locationElapsed >= LOCATION_MIN_INTERVAL && meetsDistance) reason = 'interval and distance met';
  
  return { shouldFetch, reason, adaptiveThreshold };
}

/**
 * Calculates distance moved between coordinates
 */
export function calculateMovedMeters(
  prevCoords: [number, number] | null,
  currentCoords: [number, number]
): number {
  if (!prevCoords) return Infinity;
  return distanceInMeters(
    currentCoords[0],
    currentCoords[1],
    prevCoords[0],
    prevCoords[1]
  );
}
