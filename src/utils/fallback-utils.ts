/**
 * Fallback utilities for API failures
 * Provides graceful degradation when external APIs are unavailable
 */

import { type LocationDisplay } from './location-utils';
import { type SunriseSunsetData } from './api-utils';

// === 🌍 LOCATION FALLBACKS ===

/**
 * Creates a basic location display from coordinates when LocationIQ fails
 */
export function createCoordinateFallback(lat: number, lon: number): LocationDisplay {
  // Round to 2 decimal places for readability
  const latRounded = Math.round(lat * 100) / 100;
  const lonRounded = Math.round(lon * 100) / 100;
  
  return {
    primary: `${latRounded}, ${lonRounded}`,
    country: undefined // No country info available
  };
}

/**
 * Creates a basic location display with country estimation based on coordinates
 */
export function createLocationWithCountryFallback(lat: number, lon: number): LocationDisplay & { isWater?: boolean } {
  const coords = createCoordinateFallback(lat, lon);
  
  // Basic country estimation based on coordinate ranges
  const countryInfo = estimateCountryFromCoords(lat, lon);
  
  // If we're in water region, show water body name as primary
  // This is accurate whether you're on the water or near it
  const primary = countryInfo?.isWater && countryInfo?.name
    ? countryInfo.name
    : coords.primary;
  
  // Don't show country line for water bodies (would be duplicate)
  // Just show the country code for the flag
  const country = countryInfo?.isWater ? undefined : countryInfo?.name;
  
  return {
    primary,
    country,
    countryCode: countryInfo?.code || undefined,
    isWater: countryInfo?.isWater || false
  };
}

/**
 * Estimates country from coordinates using basic geographic ranges
 * This is a fallback when LocationIQ API is unavailable
 * Returns both country name and country code for flag display
 */
function estimateCountryFromCoords(lat: number, lon: number): { name: string; code: string; isWater?: boolean } | null {
  // Gulf region - international waters (no country owns it)
  // Extended to include Honduras coast (15°N) and full Gulf region
  if (lat >= 12 && lat <= 31 && lon >= -98 && lon <= -80) {
    // Randomly alternate between names to keep everyone entertained
    const gulfNames = ['Gulf of Mexico', 'Gulf of America', 'Gulf of Autism'];
    const randomName = gulfNames[Math.floor(Math.random() * gulfNames.length)];
    console.log('🌊 GULF FALLBACK:', {
      coordinates: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      selectedName: randomName,
      allOptions: gulfNames
    });
    return { name: randomName, code: '', isWater: true };
  }
  
  // Caribbean Sea - international waters
  if (lat >= 10 && lat <= 25 && lon >= -88 && lon <= -60) {
    return { name: 'Caribbean Sea', code: '', isWater: true };
  }
  
  // Atlantic Ocean - international waters
  if (lat >= 25 && lat <= 45 && lon >= -80 && lon <= -30) {
    return { name: 'Atlantic Ocean', code: '', isWater: true };
  }
  
  // Pacific Ocean - international waters
  if (lat >= 20 && lat <= 60 && lon >= -180 && lon <= -120) {
    return { name: 'Pacific Ocean', code: '', isWater: true };
  }
  
  // Mediterranean Sea - international waters
  if (lat >= 30 && lat <= 46 && lon >= -6 && lon <= 37) {
    return { name: 'Mediterranean Sea', code: '', isWater: true };
  }
  
  // North Sea - international waters
  if (lat >= 51 && lat <= 62 && lon >= -4 && lon <= 9) {
    return { name: 'North Sea', code: '', isWater: true };
  }
  
  // Baltic Sea - international waters
  if (lat >= 53 && lat <= 66 && lon >= 9 && lon <= 31) {
    return { name: 'Baltic Sea', code: '', isWater: true };
  }
  
  // Sea of Japan - international waters
  if (lat >= 34 && lat <= 52 && lon >= 127 && lon <= 143) {
    return { name: 'Sea of Japan', code: '', isWater: true };
  }
  
  // South China Sea - international waters
  if (lat >= 0 && lat <= 25 && lon >= 100 && lon <= 121) {
    return { name: 'South China Sea', code: '', isWater: true };
  }
  
  // Japan
  if (lat >= 24 && lat <= 46 && lon >= 122 && lon <= 146) {
    return { name: 'Japan', code: 'jp' };
  }
  
  // United States
  if (lat >= 24 && lat <= 49 && lon >= -125 && lon <= -66) {
    return { name: 'United States', code: 'us' };
  }
  
  // United Kingdom
  if (lat >= 50 && lat <= 61 && lon >= -8 && lon <= 2) {
    return { name: 'United Kingdom', code: 'gb' };
  }
  
  // Australia
  if (lat >= -44 && lat <= -10 && lon >= 113 && lon <= 154) {
    return { name: 'Australia', code: 'au' };
  }
  
  // Canada
  if (lat >= 42 && lat <= 84 && lon >= -141 && lon <= -52) {
    return { name: 'Canada', code: 'ca' };
  }
  
  // Germany
  if (lat >= 47 && lat <= 55 && lon >= 6 && lon <= 15) {
    return { name: 'Germany', code: 'de' };
  }
  
  // France
  if (lat >= 42 && lat <= 51 && lon >= -5 && lon <= 8) {
    return { name: 'France', code: 'fr' };
  }
  
  // China
  if (lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135) {
    return { name: 'China', code: 'cn' };
  }
  
  // India
  if (lat >= 6 && lat <= 37 && lon >= 68 && lon <= 97) {
    return { name: 'India', code: 'in' };
  }
  
  // Brazil
  if (lat >= -34 && lat <= 5 && lon >= -74 && lon <= -34) {
    return { name: 'Brazil', code: 'br' };
  }
  
  // Russia
  if (lat >= 41 && lat <= 82 && lon >= 19 && lon <= 169) {
    return { name: 'Russia', code: 'ru' };
  }
  
  // Mexico
  if (lat >= 14 && lat <= 33 && lon >= -118 && lon <= -86) {
    return { name: 'Mexico', code: 'mx' };
  }
  
  return null; // Unknown region
}

// === 🌤️ WEATHER FALLBACKS ===

/**
 * Creates a basic weather display when OpenWeatherMap fails
 */
export function createWeatherFallback(): { temp: number; desc: string } | null {
  // Return null to hide weather when API fails
  // This provides graceful degradation
  return null;
}

/**
 * Creates a weather display with estimated temperature based on time of day
 * This is a very basic fallback when OpenWeatherMap is completely unavailable
 */
export function createEstimatedWeatherFallback(timezone?: string): { temp: number; desc: string } | null {
  try {
    const now = new Date();
    let localTime: Date;
    
    if (timezone) {
      // Use provided timezone
      const timeStr = now.toLocaleString('en-US', { 
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours));
    } else {
      localTime = now;
    }
    
    const hour = localTime.getHours();
    
    // Very basic temperature estimation based on time of day
    let estimatedTemp: number;
    let description: string;
    
    if (hour >= 6 && hour < 12) {
      // Morning: 15-25°C
      estimatedTemp = 20;
      description = 'estimated morning';
    } else if (hour >= 12 && hour < 18) {
      // Afternoon: 20-30°C
      estimatedTemp = 25;
      description = 'estimated afternoon';
    } else if (hour >= 18 && hour < 22) {
      // Evening: 15-25°C
      estimatedTemp = 20;
      description = 'estimated evening';
    } else {
      // Night: 10-20°C
      estimatedTemp = 15;
      description = 'estimated night';
    }
    
    return {
      temp: estimatedTemp,
      desc: description
    };
  } catch {
    // Weather fallback failed - silent fail for production
    return null;
  }
}

// === 🌅 SUNRISE/SUNSET FALLBACKS ===

/**
 * Creates basic sunrise/sunset data when OpenWeatherMap fails
 * Uses simple time-based estimation (not astronomically accurate)
 */
export function createSunriseSunsetFallback(timezone?: string): SunriseSunsetData | null {
  try {
    const now = new Date();
    let localTime: Date;
    
    if (timezone) {
      const timeStr = now.toLocaleString('en-US', { 
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours, minutes] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours), parseInt(minutes));
    } else {
      localTime = now;
    }
    
    // Very basic sunrise/sunset estimation
    // This is NOT astronomically accurate, just a reasonable fallback
    const sunrise = new Date(localTime);
    sunrise.setHours(6, 0, 0, 0); // 6:00 AM
    
    const sunset = new Date(localTime);
    sunset.setHours(18, 0, 0, 0); // 6:00 PM
    
    return {
      sunrise: sunrise.toISOString(),
      sunset: sunset.toISOString(),
      dayLength: '12:00:00' // 12 hours
    };
  } catch {
    // Sunrise/sunset fallback failed - silent fail for production
    return null;
  }
}

// === 🗺️ MAP FALLBACKS ===

/**
 * Determines if it's night time using fallback logic
 * Used when sunrise/sunset data is unavailable
 */
export function isNightTimeFallback(timezone?: string): boolean {
  try {
    const now = new Date();
    let localTime: Date;
    
    if (timezone) {
      const timeStr = now.toLocaleString('en-US', { 
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours, minutes] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours), parseInt(minutes));
    } else {
      localTime = now;
    }
    
    const hour = localTime.getHours();
    
    // Simple rule: night is between 7 PM and 6 AM
    return hour >= 19 || hour < 6;
  } catch {
    // Night time fallback failed - silent fail for production
    return false; // Default to day mode
  }
}

// === 🔧 UTILITY FUNCTIONS ===

/**
 * Checks if an API key is valid (basic format check)
 */
export function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.length < 10) return false; // Most API keys are longer
  if (key.includes('your-') || key.includes('replace-')) return false; // Placeholder keys
  return true;
}

/**
 * Creates a user-friendly error message for API failures
 */
export function getApiErrorMessage(apiName: string, error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return `${apiName} API key is invalid or expired`;
    }
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return `${apiName} API rate limit exceeded`;
    }
    if (error.message.includes('402') || error.message.includes('quota')) {
      return `${apiName} API quota exceeded`;
    }
    if (error.message.includes('timeout') || error.message.includes('network')) {
      return `${apiName} API is temporarily unavailable`;
    }
  }
  return `${apiName} API error occurred`;
}

/**
 * Determines if we should show fallback data or hide the feature
 */
export function shouldShowFallback(): boolean {
  // For now, always show fallbacks to maintain functionality
  // In the future, this could be configurable
  return true;
}
