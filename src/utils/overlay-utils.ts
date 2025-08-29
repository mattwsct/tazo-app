// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_COUNTRY_NAME_LENGTH = 12;
const MAX_LOCATION_FIELD_LENGTH = 20; // New constant for location field length

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
  // Additional fields from LocationIQ API
  town?: string;
  municipality?: string;
  suburb?: string;
  province?: string;
  region?: string;
  county?: string;
}

export interface LocationDisplay {
  line1: string;  // Most precise available location
  line2?: string; // Administrative context (only when multiple variables exist)
}

/**
 * Gets the best city name by intelligently selecting the most appropriate city
 * This solves the issue where APIs return smaller administrative units instead of main city names
 */
export function getBestCityName(location: LocationData): string {
  // Priority order for city names (API's preferred order)
  const cityCandidates = [
    location.city,           // Primary city field - trust the API's choice
    location.municipality,   // Municipality (often the main city for larger areas)
    location.town,           // Town (usually a proper city)
    location.suburb          // Suburb (last resort, often just neighborhood names)
  ].filter((city): city is string => Boolean(city)); // Remove undefined/null values with proper typing
  
  if (cityCandidates.length === 0) {
    return '';
  }
  
  // If we only have one candidate, use it
  if (cityCandidates.length === 1) {
    return cityCandidates[0];
  }
  
  // First, respect the API's priority order if there are no obvious redundancies
  // Only apply redundancy logic when it's clearly beneficial
  
  // Check for redundant names with administrative suffixes
  // Prefer shorter base names over longer ones with suffixes (e.g., "Tokyo" over "Tokyo Prefecture")
  for (let i = 0; i < cityCandidates.length; i++) {
    for (let j = i + 1; j < cityCandidates.length; j++) {
      if (areRedundantNames(cityCandidates[i], cityCandidates[j])) {
        // For compound names like "Las Vegas" vs "Vegas", prefer the compound name
        // For administrative suffixes like "Tokyo" vs "Tokyo Prefecture", prefer the shorter one
        const isCompound1 = cityCandidates[i].includes(' ');
        const isCompound2 = cityCandidates[j].includes(' ');
        
        if (isCompound1 && !isCompound2) {
          return cityCandidates[i]; // "Las Vegas" over "Vegas"
        }
        if (isCompound2 && !isCompound1) {
          return cityCandidates[j]; // "Las Vegas" over "Vegas"
        }
        
        // For non-compound names, prefer the shorter one (likely the base name)
        return cityCandidates[i].length <= cityCandidates[j].length ? 
               cityCandidates[i] : cityCandidates[j];
      }
    }
  }
  
  // Handle specific edge cases only
  if (cityCandidates.length === 2) {
    const [first, second] = cityCandidates;
    
    // Edge case: If one contains spaces (compound names like "Las Vegas")
    // and the other doesn't, prefer the compound name ONLY for specific cases
    const firstHasSpaces = first.includes(' ');
    const secondHasSpaces = second.includes(' ');
    
    // Only prefer compound names when they're clearly better (like "Las Vegas" vs "Paradise")
    if (firstHasSpaces && !secondHasSpaces && first.length > second.length + 2) {
      return first; // "Las Vegas" over "Paradise"
    }
    if (secondHasSpaces && !firstHasSpaces && second.length > first.length + 2) {
      return second; // "Las Vegas" over "Paradise"
    }
  }
  
  // Default: Trust the API's prioritization and return the first (primary) candidate
  // This respects the user's preference for specific names like "Manhattan" over "New York"
  return cityCandidates[0];
}

/**
 * Checks if two location names are redundant (e.g., "Tokyo" and "Tokyo Prefecture")
 */
function areRedundantNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  
  const lower1 = name1.toLowerCase();
  const lower2 = name2.toLowerCase();
  
  // Exact match
  if (lower1 === lower2) return true;
  
  // Check if one name is contained within the other (e.g., "Vegas" in "Las Vegas")
  if (lower1.includes(lower2) || lower2.includes(lower1)) {
    return true;
  }
  
  // Common redundant patterns
  const redundantSuffixes = ['prefecture', 'province', 'county', 'district', 'city', 'municipality'];
  
  for (const suffix of redundantSuffixes) {
    // Check if one is just the other + suffix (e.g., "Tokyo" vs "Tokyo Prefecture")
    if ((lower1 === lower2.replace(` ${suffix}`, '')) || 
        (lower2 === lower1.replace(` ${suffix}`, ''))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Shortens country name if too long, otherwise uses country code
 */
export function shortenCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';
  
  if (countryName && countryName.length <= MAX_COUNTRY_NAME_LENGTH) {
    return countryName;
  }
  
  if (countryName && countryName.length > MAX_COUNTRY_NAME_LENGTH) {
    return countryCode ? countryCode.toUpperCase() : countryName;
  }
  
  // If no country name but we have country code, return the code
  return countryCode ? countryCode.toUpperCase() : '';
}

/**
 * Converts Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round(celsius * 9 / 5 + 32);
}

/**
 * Converts kilometers per hour to miles per hour
 */
export function kmhToMph(kmh: number): number {
  return Math.round(kmh * 0.621371);
}

/**
 * Gets location data by precision level with smart fallbacks
 * Always returns the most precise available data for the requested level
 */
function getLocationByPrecision(location: LocationData, precision: 'suburb' | 'city' | 'state'): string {
  if (precision === 'suburb') {
    // Most specific to least specific - suburb fallback chain
    return location.suburb || location.city || location.town || location.municipality || location.state || '';
  }
  
  if (precision === 'city') {
    // City-level focus with fallbacks
    return location.city || location.town || location.municipality || location.state || '';
  }
  
  if (precision === 'state') {
    // State level - state only
    return location.state || '';
  }
  
  // Fallback to empty if nothing else works
  return '';
}

/**
 * Gets the next administrative level up for context
 * Used for line2 when we have multiple variables available
 * Checks for duplicates and falls back to next level if needed
 */
function getNextAdministrativeLevel(location: LocationData, currentPrecision: 'suburb' | 'city' | 'state'): string | null {
  if (currentPrecision === 'suburb') {
    // If we're showing suburb, next level is city
    const cityLevel = location.city || location.town || location.municipality || location.state || null;
    
    // Check if city level is the same as suburb to avoid "Houston Houston"
    if (cityLevel && location.suburb && cityLevel.toLowerCase() === location.suburb.toLowerCase()) {
      // Fall back to state level to avoid duplicates
      return location.state || null;
    }
    
    return cityLevel;
  }
  
  if (currentPrecision === 'city') {
    // If we're showing city, next level is state
    const stateLevel = location.state || null;
    
    // Check if state level is the same as city to avoid "Tokyo Tokyo"
    if (stateLevel && location.city && stateLevel.toLowerCase() === location.city.toLowerCase()) {
      // No next level available, return null for single line display
      return null;
    }
    
    return stateLevel;
  }
  
  if (currentPrecision === 'state') {
    // If we're showing state, no next level (single line display)
    return null;
  }
  
  return null;
}

/**
 * Checks if a location name is too long for display
 * Uses the MAX_LOCATION_FIELD_LENGTH constant
 */
function isLocationNameTooLong(name: string): boolean {
  return name.length > MAX_LOCATION_FIELD_LENGTH;
}

/**
 * Formats location data for overlay display with two-line precision-based logic
 * 
 * @param location - Location data from API
 * @param displayMode - Precision level: suburb (most specific), city (balanced), state (less specific), or hidden
 * @returns LocationDisplay object with line1 (required) and line2 (optional)
 * 
 * **Display Logic:**
 * - Respects user's precision setting with smart fallbacks
 * - Always shows exactly 2 variables when available
 * - Single line when only one variable exists
 * - Never shows country names
 * - Always precise → broad when showing 2 lines
 * - **NEW: Length-based fallbacks** - falls back to next precision if names are too long
 * - **NEW: Final fallback protection** - if state is too long, shows only single precision level
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'suburb' | 'city' | 'state' | 'hidden' = 'suburb'
): LocationDisplay {
  // If no location data, return empty
  if (!location) {
    return { line1: '', line2: undefined };
  }
  
  if (displayMode === 'hidden') {
    return { line1: 'Location Hidden', line2: undefined };
  }
  
  // Get the primary location name for the requested precision level
  let primaryLocation = getLocationByPrecision(location, displayMode);
  let nextLevel: string | null = null;
  
  // If primary location is too long, try fallback to next precision level
  if (primaryLocation && isLocationNameTooLong(primaryLocation)) {
    if (displayMode === 'suburb') {
      // Fall back to city precision
      const cityLocation = getLocationByPrecision(location, 'city');
      if (cityLocation && !isLocationNameTooLong(cityLocation)) {
        primaryLocation = cityLocation;
        nextLevel = getNextAdministrativeLevel(location, 'city');
      } else if (cityLocation && isLocationNameTooLong(cityLocation)) {
        // City is also too long, try state
        const stateLocation = getLocationByPrecision(location, 'state');
        if (stateLocation && !isLocationNameTooLong(stateLocation)) {
          primaryLocation = stateLocation;
          nextLevel = null; // Single line for state
        } else if (stateLocation && isLocationNameTooLong(stateLocation)) {
          // State is also too long - fall back to original precision but single line only
          const originalLocation = getLocationByPrecision(location, displayMode);
          return { line1: originalLocation, line2: undefined };
        }
      }
    } else if (displayMode === 'city') {
      // Fall back to state precision
      const stateLocation = getLocationByPrecision(location, 'state');
      if (stateLocation && !isLocationNameTooLong(stateLocation)) {
        primaryLocation = stateLocation;
        nextLevel = null; // Single line for state
      } else if (stateLocation && isLocationNameTooLong(stateLocation)) {
        // State is too long - fall back to original precision but single line only
        const originalLocation = getLocationByPrecision(location, displayMode);
        return { line1: originalLocation, line2: undefined };
      }
    }
  }
  
  // If no primary location available, try fallback to next precision level
  if (!primaryLocation) {
    if (displayMode === 'suburb') {
      // Fall back to city precision
      const cityLocation = getLocationByPrecision(location, 'city');
      if (cityLocation) {
        nextLevel = getNextAdministrativeLevel(location, 'city');
        return {
          line1: cityLocation,
          line2: nextLevel || undefined
        };
      }
      // Fall back to state precision
      const stateLocation = getLocationByPrecision(location, 'state');
      if (stateLocation) {
        return { line1: stateLocation, line2: undefined };
      }
    } else if (displayMode === 'city') {
      // Fall back to state precision
      const stateLocation = getLocationByPrecision(location, 'state');
      if (stateLocation) {
        return { line1: stateLocation, line2: undefined };
      }
    }
    
    // No location data available at any precision level
    return { line1: '', line2: undefined };
  }
  
  // If we haven't set nextLevel yet, get it now
  if (nextLevel === null) {
    nextLevel = getNextAdministrativeLevel(location, displayMode);
  }
  
  // Return structured display object
  return {
    line1: primaryLocation,
    line2: nextLevel || undefined
  };
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

// Location cache to reduce API calls
interface CachedLocation {
  lat: number;
  lon: number;
  data: LocationData;
  timestamp: number;
  expiresAt: number;
}

const locationCache = new Map<string, CachedLocation>();
const LOCATION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const LOCATION_CACHE_DISTANCE_THRESHOLD = 1000; // 1km - cache locations within this distance

/**
 * Generates a cache key for coordinates
 */
function getLocationCacheKey(lat: number, lon: number): string {
  // Round to 3 decimal places (~100m precision) for caching
  const latRounded = Math.round(lat * 1000) / 1000;
  const lonRounded = Math.round(lon * 1000) / 1000;
  return `${latRounded},${lonRounded}`;
}

/**
 * Checks if coordinates are close enough to use cached location
 */
function isLocationCacheable(lat1: number, lon1: number, lat2: number, lon2: number): boolean {
  return distanceInMeters(lat1, lon1, lat2, lon2) <= LOCATION_CACHE_DISTANCE_THRESHOLD;
}

/**
 * Gets cached location data if available and valid
 */
export function getCachedLocation(lat: number, lon: number): LocationData | null {
  const now = Date.now();
  
  // Only clean expired entries occasionally (every 10th call) to improve performance
  if (Math.random() < 0.1) {
    for (const [key, cached] of locationCache.entries()) {
      if (now > cached.expiresAt) {
        locationCache.delete(key);
      }
    }
  }
  
  // Check if we have a cached location for nearby coordinates
  for (const [key, cached] of locationCache.entries()) {
    if (isLocationCacheable(lat, lon, cached.lat, cached.lon)) {
      if (now <= cached.expiresAt) {
        return cached.data;
      } else {
        locationCache.delete(key);
      }
    }
  }
  
  return null;
}

/**
 * Caches location data for future use
 */
export function cacheLocation(lat: number, lon: number, data: LocationData): void {
  const key = getLocationCacheKey(lat, lon);
  const now = Date.now();
  
  locationCache.set(key, {
    lat,
    lon,
    data,
    timestamp: now,
    expiresAt: now + LOCATION_CACHE_DURATION
  });
  
  // Limit cache size to prevent memory issues
  if (locationCache.size > 100) {
    const oldestKey = Array.from(locationCache.keys())[0];
    locationCache.delete(oldestKey);
  }
}

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
  dailyCalls: number;
  dailyReset: number;
  dailyMax: number;
  lastCallTime: number; // Added for cooldown
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openmeteo: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 600, // 600 per minute (10 per second)
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 100000, lastCallTime: 0 // Very high daily limit for Open-Meteo
  },
  locationiq: { 
    calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2, // 2 per second (free tier limit)
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 1000, lastCallTime: 0 // 1000 per day (free tier limit)
  },
  mapbox: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 30, // 30 per minute
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 50000, lastCallTime: 0 // High daily limit for Mapbox
  },
} as const;

/**
 * Checks if API call is within rate limits (both per-second and daily)
 * Also enforces a cooldown period to prevent rapid successive calls
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Enforce cooldown period (minimum 2 seconds between calls for LocationIQ)
  const cooldownPeriod = api === 'locationiq' ? 2000 : 1000;
  if (now - limit.lastCallTime < cooldownPeriod) {
    return false;
  }
  
  // Reset per-second limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  // Check if daily limit reached
  if (limit.dailyCalls >= limit.dailyMax) {
    return false;
  }
  
  // Check if per-second limit reached
  if (limit.calls >= limit.max) {
    return false;
  }
  
  limit.calls++;
  limit.dailyCalls++;
  limit.lastCallTime = now; // Update last call time
  return true;
}

/**
 * Gets remaining daily API calls for an API
 */
export function getRemainingDailyCalls(api: keyof typeof RATE_LIMITS): number {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  return Math.max(0, limit.dailyMax - limit.dailyCalls);
}

/**
 * Gets current daily API usage statistics
 */
export function getDailyUsageStats(api: keyof typeof RATE_LIMITS): {
  used: number;
  remaining: number;
  total: number;
  resetTime: string;
  percentageUsed: number;
} {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  const used = limit.dailyCalls;
  const remaining = Math.max(0, limit.dailyMax - used);
  const percentageUsed = Math.round((used / limit.dailyMax) * 100);
  const resetTime = new Date(today + 86400000).toISOString();
  
  return {
    used,
    remaining,
    total: limit.dailyMax,
    resetTime,
    percentageUsed
  };
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

 