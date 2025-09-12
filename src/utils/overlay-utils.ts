// === 🔄 OVERLAY UTILITIES ===
// This file now contains only overlay-specific utilities that don't fit elsewhere

// Re-export from centralized unit conversions
export { celsiusToFahrenheit, kmhToMph } from './unit-conversions';

// Re-export from location utilities
export { 
  formatLocation,
  distanceInMeters,
  isValidCoordinate,
  type LocationData,
  type LocationDisplay
} from './location-utils';

// Re-export from rate limiting
export { 
  checkRateLimit,
  RATE_LIMITS
} from './rate-limiting';

/**
 * Capitalizes the first letter of each word
 */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

 