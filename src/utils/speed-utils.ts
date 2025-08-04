import { THRESHOLDS, SPEED_ANIMATION } from './overlay-constants';
import { OverlayLogger } from '@/lib/logger';

// Speed conversion utilities
export const getSpeedKmh = (speedMs: number): number => speedMs * 3.6;
export const kmhToMph = (kmh: number): number => kmh * 0.621371;

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

// Speed animation utilities
export const createSpeedAnimation = (
  fromSpeed: number, 
  toSpeed: number, 
  onStep: (speed: number) => void,
  onComplete: () => void
): (() => void) => {
  const speedDifference = Math.abs(toSpeed - fromSpeed);
  
  // Skip animation for small changes
  if (speedDifference < SPEED_ANIMATION.THRESHOLD) {
    onStep(toSpeed);
    onComplete();
    return () => {}; // No cleanup needed
  }

  const steps = SPEED_ANIMATION.STEPS;
  const stepSize = (toSpeed - fromSpeed) / steps;
  const stepDuration = SPEED_ANIMATION.STEP_DURATION;
  
  let step = 0;
  const interval = setInterval(() => {
    step++;
    const newSpeed = fromSpeed + (stepSize * step);
    onStep(newSpeed);
    
    if (step >= steps) {
      clearInterval(interval);
      onComplete();
    }
  }, stepDuration);
  
  return () => clearInterval(interval);
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