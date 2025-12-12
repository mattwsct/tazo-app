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
    secondary: undefined // No country info available
  };
}

/**
 * Creates a basic location display with country estimation based on coordinates
 * Never shows raw coordinates - only shows country if estimable, or ocean names if on water
 * @param lat - Latitude
 * @param lon - Longitude
 * @param isLocationIQ404 - True if LocationIQ returned 404 (no address found), likely on water
 */
export function createLocationWithCountryFallback(
  lat: number, 
  lon: number, 
  isLocationIQ404: boolean = false
): LocationDisplay & { isWater?: boolean } {
  // Basic country estimation based on coordinate ranges
  const countryInfo = estimateCountryFromCoords(lat, lon);
  
  // Only show ocean/water names if:
  // 1. LocationIQ returned 404 (no address found - likely on water)
  // 2. AND coordinates match known water bodies (not near land)
  // This prevents showing ocean names when LocationIQ fails for other reasons (API issues, rate limits, etc.)
  // or when in remote land areas
  const shouldShowWater = isLocationIQ404 && countryInfo?.isWater;
  
  // Never show coordinates - only show meaningful location names
  // If on water and LocationIQ returned 404, show ocean name
  // Otherwise, show country if estimable (and it's NOT a water body), or nothing
  const primary = shouldShowWater && countryInfo?.name
    ? countryInfo.name
    : ''; // Don't show coordinates - show nothing instead
  
  // Don't show country line for water bodies (would be duplicate)
  // Show country only if we're on land (not water) and can estimate it
  // IMPORTANT: Don't show water bodies as countries - only show actual countries
  const secondary = shouldShowWater || countryInfo?.isWater 
    ? undefined 
    : countryInfo?.name;
  
  return {
    primary,
    secondary,
    countryCode: countryInfo?.code || undefined,
    isWater: shouldShowWater || false
  };
}

// Country coordinate ranges - shared data structure to avoid duplication
interface CountryBounds {
  name: string;
  code: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

const COUNTRY_BOUNDS: CountryBounds[] = [
  { name: 'United States', code: 'us', latMin: 24, latMax: 49, lonMin: -125, lonMax: -66 },
  { name: 'Canada', code: 'ca', latMin: 42, latMax: 84, lonMin: -141, lonMax: -52 },
  { name: 'Mexico', code: 'mx', latMin: 14, latMax: 33, lonMin: -118, lonMax: -86 },
  { name: 'Japan', code: 'jp', latMin: 24, latMax: 46, lonMin: 122, lonMax: 146 },
  { name: 'United Kingdom', code: 'gb', latMin: 50, latMax: 61, lonMin: -8, lonMax: 2 },
  { name: 'Australia', code: 'au', latMin: -44, latMax: -10, lonMin: 113, lonMax: 154 },
  { name: 'Germany', code: 'de', latMin: 47, latMax: 55, lonMin: 6, lonMax: 15 },
  { name: 'France', code: 'fr', latMin: 42, latMax: 51, lonMin: -5, lonMax: 8 },
  { name: 'China', code: 'cn', latMin: 18, latMax: 54, lonMin: 73, lonMax: 135 },
  { name: 'India', code: 'in', latMin: 6, latMax: 37, lonMin: 68, lonMax: 97 },
  { name: 'Brazil', code: 'br', latMin: -34, latMax: 5, lonMin: -74, lonMax: -34 },
  { name: 'Russia', code: 'ru', latMin: 41, latMax: 82, lonMin: 19, lonMax: 169 },
  { name: 'Spain', code: 'es', latMin: 36, latMax: 44, lonMin: -10, lonMax: 5 },
  { name: 'Portugal', code: 'pt', latMin: 37, latMax: 42, lonMin: -10, lonMax: -6 },
  { name: 'Italy', code: 'it', latMin: 36, latMax: 47, lonMin: 6, lonMax: 19 },
  { name: 'South Korea', code: 'kr', latMin: 33, latMax: 39, lonMin: 124, lonMax: 132 },
  { name: 'Thailand', code: 'th', latMin: 5, latMax: 21, lonMin: 97, lonMax: 106 },
  { name: 'Vietnam', code: 'vn', latMin: 8, latMax: 24, lonMin: 102, lonMax: 110 },
  { name: 'Philippines', code: 'ph', latMin: 5, latMax: 21, lonMin: 116, lonMax: 127 },
  { name: 'Indonesia', code: 'id', latMin: -11, latMax: 6, lonMin: 95, lonMax: 141 },
  { name: 'New Zealand', code: 'nz', latMin: -47, latMax: -34, lonMin: 166, lonMax: 179 },
  { name: 'South Africa', code: 'za', latMin: -35, latMax: -22, lonMin: 16, lonMax: 33 },
  { name: 'Argentina', code: 'ar', latMin: -56, latMax: -21, lonMin: -74, lonMax: -53 },
  { name: 'Chile', code: 'cl', latMin: -56, latMax: -17, lonMin: -76, lonMax: -66 },
];

/**
 * Estimates country code from coordinates when LocationIQ doesn't provide it
 * This is a lightweight helper that only returns the country code
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns ISO country code (lowercase) or null if cannot be determined
 */
export function estimateCountryCodeFromCoords(lat: number, lon: number): string | null {
  const country = COUNTRY_BOUNDS.find(
    (c) => lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
  );
  return country?.code || null;
}

/**
 * Estimates country from coordinates using basic geographic ranges
 * This is a fallback when LocationIQ API is unavailable
 * Returns both country name and country code for flag display
 * IMPORTANT: Check countries/land FIRST, then water bodies
 * This prevents land locations (like Las Vegas) from being incorrectly identified as oceans
 */
function estimateCountryFromCoords(lat: number, lon: number): { name: string; code: string; isWater?: boolean } | null {
  // Check countries first (using shared data structure)
  const country = COUNTRY_BOUNDS.find(
    (c) => lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
  );
  if (country) {
    return { name: country.name, code: country.code };
  }
  
  // === MAJOR SEAS AND GULFS (check after countries) ===
  
  // Gulf of Mexico - international waters
  if (lat >= 18 && lat <= 31 && lon >= -98 && lon <= -80) {
    return { name: 'Gulf of Mexico', code: '', isWater: true };
  }
  
  // Caribbean Sea - international waters
  if (lat >= 9 && lat <= 25 && lon >= -89 && lon <= -60) {
    return { name: 'Caribbean Sea', code: '', isWater: true };
  }
  
  // Mediterranean Sea - international waters
  if (lat >= 30 && lat <= 46 && lon >= -6 && lon <= 37) {
    return { name: 'Mediterranean Sea', code: '', isWater: true };
  }
  
  // Black Sea - international waters
  if (lat >= 40 && lat <= 47 && lon >= 27 && lon <= 42) {
    return { name: 'Black Sea', code: '', isWater: true };
  }
  
  // Red Sea - international waters
  if (lat >= 12 && lat <= 30 && lon >= 32 && lon <= 44) {
    return { name: 'Red Sea', code: '', isWater: true };
  }
  
  // Arabian Sea - international waters
  if (lat >= 0 && lat <= 25 && lon >= 50 && lon <= 78) {
    return { name: 'Arabian Sea', code: '', isWater: true };
  }
  
  // Bay of Bengal - international waters
  if (lat >= 5 && lat <= 22 && lon >= 80 && lon <= 100) {
    return { name: 'Bay of Bengal', code: '', isWater: true };
  }
  
  // South China Sea - international waters
  if (lat >= 0 && lat <= 25 && lon >= 105 && lon <= 121) {
    return { name: 'South China Sea', code: '', isWater: true };
  }
  
  // East China Sea - international waters
  if (lat >= 24 && lat <= 35 && lon >= 120 && lon <= 130) {
    return { name: 'East China Sea', code: '', isWater: true };
  }
  
  // Sea of Japan - international waters
  if (lat >= 35 && lat <= 52 && lon >= 127 && lon <= 142) {
    return { name: 'Sea of Japan', code: '', isWater: true };
  }
  
  // Yellow Sea - international waters
  if (lat >= 33 && lat <= 41 && lon >= 119 && lon <= 127) {
    return { name: 'Yellow Sea', code: '', isWater: true };
  }
  
  // North Sea - international waters
  if (lat >= 51 && lat <= 62 && lon >= -4 && lon <= 9) {
    return { name: 'North Sea', code: '', isWater: true };
  }
  
  // Baltic Sea - international waters
  if (lat >= 53 && lat <= 66 && lon >= 9 && lon <= 31) {
    return { name: 'Baltic Sea', code: '', isWater: true };
  }
  
  // Bering Sea - international waters
  if (lat >= 52 && lat <= 66 && lon >= -180 && lon <= -157) {
    return { name: 'Bering Sea', code: '', isWater: true };
  }
  
  // Gulf of Alaska - international waters
  if (lat >= 54 && lat <= 60 && lon >= -160 && lon <= -140) {
    return { name: 'Gulf of Alaska', code: '', isWater: true };
  }
  
  // Gulf of California - international waters
  if (lat >= 23 && lat <= 32 && lon >= -115 && lon <= -107) {
    return { name: 'Gulf of California', code: '', isWater: true };
  }
  
  // Persian Gulf - international waters
  if (lat >= 24 && lat <= 30 && lon >= 48 && lon <= 57) {
    return { name: 'Persian Gulf', code: '', isWater: true };
  }
  
  // Gulf of Aden - international waters
  if (lat >= 11 && lat <= 15 && lon >= 42 && lon <= 52) {
    return { name: 'Gulf of Aden', code: '', isWater: true };
  }
  
  // Andaman Sea - international waters
  if (lat >= 5 && lat <= 15 && lon >= 92 && lon <= 100) {
    return { name: 'Andaman Sea', code: '', isWater: true };
  }
  
  // Java Sea - international waters
  if (lat >= -7 && lat <= 5 && lon >= 105 && lon <= 116) {
    return { name: 'Java Sea', code: '', isWater: true };
  }
  
  // Philippine Sea - international waters
  if (lat >= 0 && lat <= 35 && lon >= 120 && lon <= 140) {
    return { name: 'Philippine Sea', code: '', isWater: true };
  }
  
  // Coral Sea - international waters
  if (lat >= -30 && lat <= -10 && lon >= 145 && lon <= 165) {
    return { name: 'Coral Sea', code: '', isWater: true };
  }
  
  // Tasman Sea - international waters
  if (lat >= -48 && lat <= -30 && lon >= 150 && lon <= 175) {
    return { name: 'Tasman Sea', code: '', isWater: true };
  }
  
  // Gulf of Thailand - international waters
  if (lat >= 7 && lat <= 13 && lon >= 99 && lon <= 105) {
    return { name: 'Gulf of Thailand', code: '', isWater: true };
  }
  
  // Sulu Sea - international waters
  if (lat >= 5 && lat <= 12 && lon >= 118 && lon <= 122) {
    return { name: 'Sulu Sea', code: '', isWater: true };
  }
  
  // Celebes Sea - international waters
  if (lat >= 0 && lat <= 6 && lon >= 118 && lon <= 125) {
    return { name: 'Celebes Sea', code: '', isWater: true };
  }
  
  // Banda Sea - international waters
  if (lat >= -8 && lat <= -4 && lon >= 125 && lon <= 130) {
    return { name: 'Banda Sea', code: '', isWater: true };
  }
  
  // Arafura Sea - international waters
  if (lat >= -12 && lat <= -5 && lon >= 130 && lon <= 141) {
    return { name: 'Arafura Sea', code: '', isWater: true };
  }
  
  // Timor Sea - international waters
  if (lat >= -14 && lat <= -9 && lon >= 122 && lon <= 130) {
    return { name: 'Timor Sea', code: '', isWater: true };
  }
  
  // Gulf of Guinea - international waters
  if (lat >= -2 && lat <= 7 && lon >= -10 && lon <= 9) {
    return { name: 'Gulf of Guinea', code: '', isWater: true };
  }
  
  // Gulf of Aden (already covered above, but ensuring coverage)
  
  // Adriatic Sea - international waters
  if (lat >= 40 && lat <= 46 && lon >= 12 && lon <= 20) {
    return { name: 'Adriatic Sea', code: '', isWater: true };
  }
  
  // Aegean Sea - international waters
  if (lat >= 35 && lat <= 41 && lon >= 23 && lon <= 30) {
    return { name: 'Aegean Sea', code: '', isWater: true };
  }
  
  // Ionian Sea - international waters
  if (lat >= 36 && lat <= 40 && lon >= 18 && lon <= 22) {
    return { name: 'Ionian Sea', code: '', isWater: true };
  }
  
  // Tyrrhenian Sea - international waters
  if (lat >= 38 && lat <= 41 && lon >= 10 && lon <= 15) {
    return { name: 'Tyrrhenian Sea', code: '', isWater: true };
  }
  
  // Ligurian Sea - international waters
  if (lat >= 42 && lat <= 44 && lon >= 7 && lon <= 10) {
    return { name: 'Ligurian Sea', code: '', isWater: true };
  }
  
  // Gulf of Bothnia - international waters
  if (lat >= 60 && lat <= 66 && lon >= 19 && lon <= 31) {
    return { name: 'Gulf of Bothnia', code: '', isWater: true };
  }
  
  // Gulf of Finland - international waters
  if (lat >= 59 && lat <= 61 && lon >= 22 && lon <= 31) {
    return { name: 'Gulf of Finland', code: '', isWater: true };
  }
  
  // Irish Sea - international waters
  if (lat >= 51 && lat <= 55 && lon >= -6 && lon <= -3) {
    return { name: 'Irish Sea', code: '', isWater: true };
  }
  
  // English Channel - international waters
  if (lat >= 49 && lat <= 51 && lon >= -6 && lon <= 2) {
    return { name: 'English Channel', code: '', isWater: true };
  }
  
  // Celtic Sea - international waters
  if (lat >= 48 && lat <= 52 && lon >= -11 && lon <= -4) {
    return { name: 'Celtic Sea', code: '', isWater: true };
  }
  
  // Bay of Biscay - international waters
  if (lat >= 43 && lat <= 48 && lon >= -10 && lon <= -1) {
    return { name: 'Bay of Biscay', code: '', isWater: true };
  }
  
  // Gulf of St. Lawrence - international waters
  if (lat >= 46 && lat <= 51 && lon >= -70 && lon <= -57) {
    return { name: 'Gulf of St. Lawrence', code: '', isWater: true };
  }
  
  // Hudson Bay - international waters
  if (lat >= 51 && lat <= 64 && lon >= -95 && lon <= -78) {
    return { name: 'Hudson Bay', code: '', isWater: true };
  }
  
  // Beaufort Sea - international waters
  if (lat >= 69 && lat <= 76 && lon >= -142 && lon <= -124) {
    return { name: 'Beaufort Sea', code: '', isWater: true };
  }
  
  // Chukchi Sea - international waters
  if (lat >= 66 && lat <= 72 && lon >= -180 && lon <= -157) {
    return { name: 'Chukchi Sea', code: '', isWater: true };
  }
  
  // East Siberian Sea - international waters
  if (lat >= 70 && lat <= 77 && lon >= 140 && lon <= 180) {
    return { name: 'East Siberian Sea', code: '', isWater: true };
  }
  
  // Laptev Sea - international waters
  if (lat >= 72 && lat <= 81 && lon >= 100 && lon <= 140) {
    return { name: 'Laptev Sea', code: '', isWater: true };
  }
  
  // Kara Sea - international waters
  if (lat >= 69 && lat <= 81 && lon >= 55 && lon <= 100) {
    return { name: 'Kara Sea', code: '', isWater: true };
  }
  
  // Barents Sea - international waters
  if (lat >= 70 && lat <= 82 && lon >= 16 && lon <= 55) {
    return { name: 'Barents Sea', code: '', isWater: true };
  }
  
  // Norwegian Sea - international waters
  if (lat >= 62 && lat <= 72 && lon >= -5 && lon <= 16) {
    return { name: 'Norwegian Sea', code: '', isWater: true };
  }
  
  // Greenland Sea - international waters
  if (lat >= 70 && lat <= 82 && lon >= -20 && lon <= -5) {
    return { name: 'Greenland Sea', code: '', isWater: true };
  }
  
  // Labrador Sea - international waters
  if (lat >= 54 && lat <= 66 && lon >= -61 && lon <= -50) {
    return { name: 'Labrador Sea', code: '', isWater: true };
  }
  
  // Davis Strait - international waters
  if (lat >= 60 && lat <= 70 && lon >= -70 && lon <= -50) {
    return { name: 'Davis Strait', code: '', isWater: true };
  }
  
  // Baffin Bay - international waters
  if (lat >= 70 && lat <= 78 && lon >= -80 && lon <= -60) {
    return { name: 'Baffin Bay', code: '', isWater: true };
  }
  
  // === MAJOR OCEANS (check after specific seas and countries) ===
  // Note: Ocean boundaries are intentionally conservative to avoid false matches on land
  // They only match when we're confident it's actually water, not coastal land
  
  // Pacific Ocean - covers most of Pacific basin
  // North Pacific (excludes North America - already checked above)
  if (lat >= 0 && lat <= 66 && lon >= -180 && lon <= -100) {
    return { name: 'Pacific Ocean', code: '', isWater: true };
  }
  // South Pacific (excludes South America - Chile/Argentina already checked above)
  if (lat >= -66 && lat <= 0 && lon >= -180 && lon <= -70) {
    return { name: 'Pacific Ocean', code: '', isWater: true };
  }
  // West Pacific (east of Asia, excludes China/Japan/Korea/Philippines - already checked above)
  if (lat >= 0 && lat <= 66 && lon >= 100 && lon <= 180) {
    return { name: 'Pacific Ocean', code: '', isWater: true };
  }
  // South West Pacific (excludes Australia/New Zealand/Indonesia - already checked above)
  if (lat >= -66 && lat <= 0 && lon >= 140 && lon <= 180) {
    return { name: 'Pacific Ocean', code: '', isWater: true };
  }
  
  // Atlantic Ocean - covers most of Atlantic basin
  // North Atlantic (excludes North America/Western Europe - already checked above)
  if (lat >= 0 && lat <= 66 && lon >= -80 && lon <= 0) {
    return { name: 'Atlantic Ocean', code: '', isWater: true };
  }
  // South Atlantic (excludes South America - Brazil/Argentina already checked above)
  if (lat >= -66 && lat <= 0 && lon >= -50 && lon <= 20) {
    return { name: 'Atlantic Ocean', code: '', isWater: true };
  }
  // Mid-Atlantic (between Americas and Africa - open ocean only)
  if (lat >= -30 && lat <= 30 && lon >= -50 && lon <= -20) {
    return { name: 'Atlantic Ocean', code: '', isWater: true };
  }
  
  // Indian Ocean - covers most of Indian Ocean basin
  // Excludes India/Thailand/Indonesia/Vietnam - already checked above
  if (lat >= -66 && lat <= 30 && lon >= 20 && lon <= 147) {
    return { name: 'Indian Ocean', code: '', isWater: true };
  }
  
  // Arctic Ocean - covers Arctic region
  if (lat >= 66 && lat <= 90) {
    return { name: 'Arctic Ocean', code: '', isWater: true };
  }
  
  // Southern Ocean (Antarctic) - around Antarctica
  if (lat <= -60) {
    return { name: 'Southern Ocean', code: '', isWater: true };
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
