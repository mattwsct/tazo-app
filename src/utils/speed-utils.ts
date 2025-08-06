import { THRESHOLDS } from './overlay-constants';
import { OverlayLogger } from '@/lib/logger';

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

export const kmhToMph = (kmh: number): number => {
  // Validate input
  if (typeof kmh !== 'number' || isNaN(kmh) || kmh < 0) {
    return 0;
  }
  
  // Convert km/h to mph
  return kmh * 0.621371;
};

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
    return THRESHOLDS.LOCATION_DISTANCE; // Standard threshold
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