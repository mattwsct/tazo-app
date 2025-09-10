import { THRESHOLDS, DYNAMIC_TIMERS } from './overlay-constants';
import { OverlayLogger } from '@/lib/logger';
// import { kmhToMph } from './unit-conversions'; // Currently unused but kept for future use

// Speed conversion utilities
// RTIRL provides speed in meters per second (m/s)
// Conversion: m/s * 3.6 = km/h
export const getSpeedKmh = (speedMs: number): number => {
  // Validate input
  if (typeof speedMs !== 'number' || isNaN(speedMs) || speedMs < 0) {
    OverlayLogger.warn('Invalid speed value received', { speedMs });
    return 0;
  }
  
  // Convert m/s to km/h
  const kmh = speedMs * 3.6;
  
  // Log conversion for debugging
  if (kmh > 10) { // Only log when speed is significant
    OverlayLogger.overlay('Speed conversion', {
      rawSpeedMs: speedMs,
      convertedKmh: Math.round(kmh * 10) / 10
    });
  }
  
  return kmh;
};

// Re-export from centralized unit conversions
// export { kmhToMph } from './unit-conversions'; // Currently unused but kept for future use

// Speed threshold utilities
export const isAboveSpeedThreshold = (speedKmh: number, threshold: number = THRESHOLDS.SPEED_SHOW): boolean => 
  speedKmh >= threshold;

// Adaptive distance threshold based on speed
export const getAdaptiveDistanceThreshold = (speedKmh: number): number => {
  if (speedKmh >= THRESHOLDS.BULLET_TRAIN_SPEED) {
    return 5000; // 5km - very conservative for bullet train speeds
  } else if (speedKmh >= THRESHOLDS.HIGH_SPEED_THRESHOLD) {
    return Math.max(500, speedKmh * 10); // Scales with speed, minimum 500m
  } else {
    return THRESHOLDS.LOCATION_DISTANCE_DEFAULT; // Standard threshold
  }
};

// Speed visibility logging
export const logSpeedVisibility = (
  action: 'shown' | 'hidden', 
  element: 'Minimap' | 'Speed indicator', 
  kmh: number
): void => {
  const reason = action === 'shown' ? 'speed threshold' : 'speed drop';
  OverlayLogger.overlay(`${element} ${action} due to ${reason}`, { 
    speed: kmh, 
    threshold: THRESHOLDS.SPEED_SHOW 
  });
};

// Speed data staleness check
export const checkSpeedDataStale = (lastSpeedUpdate: number): { isStale: boolean; timeSinceLastUpdate: number } => {
  const timeSinceLastUpdate = Date.now() - lastSpeedUpdate;
  const isStale = timeSinceLastUpdate > 10000; // 10 seconds
  
  if (isStale) {
    OverlayLogger.overlay('Speed data is stale', {
      timeSinceLastUpdate,
      timeout: 10000,
      isStale
    });
  }
  
  return { isStale, timeSinceLastUpdate };
};

// Movement-based intelligence functions
/**
 * Determines movement state based on speed
 */
export const getMovementState = (speedKmh: number): 'stationary' | 'moving' | 'high-speed' => {
  if (speedKmh < THRESHOLDS.STATIONARY_THRESHOLD) {
    return 'stationary';
  } else if (speedKmh >= THRESHOLDS.HIGH_SPEED_MOVEMENT) {
    return 'high-speed';
  } else {
    return 'moving';
  }
};

/**
 * Gets dynamic weather polling interval based on movement state
 */
export const getWeatherPollingInterval = (speedKmh: number): number => {
  const movementState = getMovementState(speedKmh);
  
  switch (movementState) {
    case 'stationary':
      return DYNAMIC_TIMERS.WEATHER_STATIONARY;
    case 'moving':
      return DYNAMIC_TIMERS.WEATHER_MOVING;
    case 'high-speed':
      return DYNAMIC_TIMERS.WEATHER_HIGH_SPEED;
    default:
      return DYNAMIC_TIMERS.WEATHER_MOVING;
  }
};

/**
 * Gets dynamic location polling interval based on movement state
 */
export const getLocationPollingInterval = (speedKmh: number): number => {
  const movementState = getMovementState(speedKmh);
  
  switch (movementState) {
    case 'stationary':
      return DYNAMIC_TIMERS.LOCATION_STATIONARY;
    case 'moving':
      return DYNAMIC_TIMERS.LOCATION_MOVING;
    case 'high-speed':
      return DYNAMIC_TIMERS.LOCATION_HIGH_SPEED;
    default:
      return DYNAMIC_TIMERS.LOCATION_MOVING;
  }
};

/**
 * Gets dynamic map update interval based on movement state
 */
export const getMapUpdateInterval = (speedKmh: number): number => {
  const movementState = getMovementState(speedKmh);
  
  switch (movementState) {
    case 'stationary':
      return DYNAMIC_TIMERS.MAP_STATIONARY;
    case 'moving':
      return DYNAMIC_TIMERS.MAP_MOVING;
    case 'high-speed':
      return DYNAMIC_TIMERS.MAP_HIGH_SPEED;
    default:
      return DYNAMIC_TIMERS.MAP_MOVING;
  }
}; 