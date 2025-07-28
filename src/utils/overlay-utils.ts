// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_COUNTRY_NAME_LENGTH = 12;
const MAX_LOCATION_FIELD_LENGTH = 16;

export interface LocationData {
  country?: string;
  countryCode?: string;
  city?: string;
  state?: string;
  displayName?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
}

/**
 * Shortens country name if too long, otherwise uses country code
 */
export function shortenCountryName(countryName: string, countryCode = ''): string {
  if (!countryName) return '';
  
  if (countryName.length <= MAX_COUNTRY_NAME_LENGTH) {
    return countryName;
  }
  
  return countryCode ? countryCode.toUpperCase() : countryName;
}

/**
 * Converts Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round(celsius * 9 / 5 + 32);
}

/**
 * Formats location data for overlay display
 * Follows user preference: City, Country OR State, Country (max 16 chars per field)
 */
export function formatLocation(location: LocationData, displayMode: 'city' | 'state' | 'country' | 'hidden' = 'city'): string {
  if (!location) return '';
  
  if (displayMode === 'hidden') {
    return 'Location Hidden';
  }
  
  const shortenedCountry = shortenCountryName(location.country || '', location.countryCode || '');
  const fullCountry = location.country || location.countryCode?.toUpperCase() || '';
  
  if (displayMode === 'city') {
    if (location.city && location.city.length <= MAX_LOCATION_FIELD_LENGTH) {
      return `${location.city}, ${shortenedCountry}`;
    }
    
    if (location.state && location.state.length <= MAX_LOCATION_FIELD_LENGTH) {
      return `${location.state}, ${shortenedCountry}`;
    }
    
    return fullCountry;
  }
  
  if (displayMode === 'state') {
    if (location.state && location.state.length <= MAX_LOCATION_FIELD_LENGTH) {
      return `${location.state}, ${shortenedCountry}`;
    }
    
    return fullCountry;
  }
  
  if (displayMode === 'country') {
    return fullCountry;
  }
  
  return '';
}

/**
 * Calculates distance between two coordinates in meters using Haversine formula
 */
export function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Capitalizes the first letter of each word
 */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// === 🔄 RATE LIMITING ===

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openmeteo: { calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 600 },
  locationiq: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 },
} as const;

/**
 * Checks if API call is within rate limits
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  if (limit.calls >= limit.max) {
    return false;
  }
  
  limit.calls++;
  return true;
}

/**
 * Validates coordinate values are within valid ranges
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' && 
    typeof lon === 'number' && 
    !isNaN(lat) && 
    !isNaN(lon) && 
    lat >= -90 && 
    lat <= 90 && 
    lon >= -180 && 
    lon <= 180
  );
}

 