/**
 * Fallback utilities for API failures
 * Provides graceful degradation when external APIs are unavailable
 * Re-export facade: implementations are in sub-modules.
 */

export {
  createLocationWithCountryFallback,
  estimateCountryCodeFromCoords,
} from './fallback/geo-fallback';

export {
  createWeatherFallback,
  createEstimatedWeatherFallback,
  createSunriseSunsetFallback,
  isNightTimeFallback,
  isValidApiKey,
} from './fallback/weather-fallback';
