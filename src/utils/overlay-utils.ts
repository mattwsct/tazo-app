// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

// Maximum character length for country names before using country code
const MAX_COUNTRY_NAME_LENGTH = 12;

// Interface for location data
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
 * Smart country name shortening for overlay display
 * Uses full name if short enough, otherwise uses country code
 */
export function shortenCountryName(countryName: string, countryCode = ''): string {
  if (!countryName) return '';
  
  // If country name is short enough, use it as is
  if (countryName.length <= MAX_COUNTRY_NAME_LENGTH) {
    return countryName;
  }
  
  // If country name is too long and we have a country code, use the code
  if (countryCode) {
    return countryCode.toUpperCase();
  }
  
  // Fallback: use the original country name even if it's long
  return countryName;
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
  
  if (displayMode === 'city') {
    if (location.city) {
      return `${location.city}, ${shortenedCountry}`;
    }
    
    // Fallback to state if no city
    if (location.state) {
      return `${location.state}, ${shortenedCountry}`;
    }
    
    // Final fallback: just country
    return shortenedCountry;
  }
  
  if (displayMode === 'state') {
    if (location.state) {
      return `${location.state}, ${shortenedCountry}`;
    }
    
    // Fallback to city if no state
    if (location.city) {
      return `${location.city}, ${shortenedCountry}`;
    }
    
    // Final fallback: just country
    return shortenedCountry;
  }
  
  if (displayMode === 'country') {
    return shortenedCountry;
  }
  
  return '';
}

/**
 * Calculates distance between two coordinates in meters
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

// === 📝 TEXT UTILITIES ===

/**
 * Capitalizes the first letter of each word
 */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// === 🌤️ WEATHER UTILITIES ===

/**
 * Maps WMO Weather Code to OpenWeather icon format
 */
export function mapWMOToOpenWeatherIcon(wmoCode: number): string {
  const iconMap: Record<number, string> = {
    0: '01d',    // Clear sky
    1: '02d',    // Mainly clear
    2: '03d',    // Partly cloudy
    3: '04d',    // Overcast
    45: '50d',   // Fog
    48: '50d',   // Depositing rime fog
    51: '09d',   // Light drizzle
    53: '09d',   // Moderate drizzle
    55: '09d',   // Dense drizzle
    56: '13d',   // Light freezing drizzle
    57: '13d',   // Dense freezing drizzle
    61: '10d',   // Slight rain
    63: '10d',   // Moderate rain
    65: '10d',   // Heavy rain
    66: '13d',   // Light freezing rain
    67: '13d',   // Heavy freezing rain
    71: '13d',   // Slight snow fall
    73: '13d',   // Moderate snow fall
    75: '13d',   // Heavy snow fall
    77: '13d',   // Snow grains
    80: '09d',   // Slight rain showers
    81: '09d',   // Moderate rain showers
    82: '09d',   // Violent rain showers
    85: '13d',   // Slight snow showers
    86: '13d',   // Heavy snow showers
    95: '11d',   // Thunderstorm
    96: '11d',   // Thunderstorm with slight hail
    99: '11d',   // Thunderstorm with heavy hail
  };
  return iconMap[wmoCode] || '01d';
}

/**
 * Maps WMO Weather Code to human-readable description
 */
export function mapWMOToDescription(wmoCode: number): string {
  const descMap: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'light freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snow fall',
    73: 'moderate snow fall',
    75: 'heavy snow fall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail',
    99: 'thunderstorm with heavy hail',
  };
  return descMap[wmoCode] || 'unknown';
}

// === 🔄 RATE LIMITING ===

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openmeteo: { calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 600 }, // 600/min free tier
  locationiq: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 }, // 2/sec official limit
} as const;

/**
 * Checks if API call is within rate limits
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset counter if interval has passed
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Check if limit exceeded
  if (limit.calls >= limit.max) {
    return false;
  }
  
  // Increment counter and allow
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

/**
 * Validates coordinate precision and realistic bounds
 */
export function isValidCoordinatePrecision(lat: number, lon: number): boolean {
  // Check basic validity first
  if (!isValidCoordinate(lat, lon)) {
    return false;
  }
  
  // Check for reasonable precision (not too many decimal places)
  const latStr = Math.abs(lat).toString();
  const lonStr = Math.abs(lon).toString();
  
  // Should not have more than 6 decimal places (about 1 meter precision)
  const latDecimals = latStr.includes('.') ? latStr.split('.')[1]?.length || 0 : 0;
  const lonDecimals = lonStr.includes('.') ? lonStr.split('.')[1]?.length || 0 : 0;
  
  if (latDecimals > 6 || lonDecimals > 6) {
    return false;
  }
  
  // Check for obviously wrong coordinates (like 0,0 in the ocean)
  // This is a basic check - could be expanded for specific regions
  if (lat === 0 && lon === 0) {
    return false; // Gulf of Guinea - unlikely to be correct
  }
  
  return true;
} 