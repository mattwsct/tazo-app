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
  // Additional fields from LocationIQ API
  town?: string;
  municipality?: string;
  suburb?: string;
  province?: string;
  region?: string;
  county?: string;
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
 * Helper function to get the best available location name based on priority order
 */
function getBestLocationName(location: LocationData, priorityOrder: (keyof LocationData)[]): string {
  for (const field of priorityOrder) {
    const value = location[field];
    if (value && typeof value === 'string' && value.length <= MAX_LOCATION_FIELD_LENGTH) {
      return value;
    }
  }
  
  // Final fallback to state or country
  if (location.state && location.state.length <= MAX_LOCATION_FIELD_LENGTH) {
    return location.state;
  }
  
  return shortenCountryName(location.country || '', location.countryCode || '');
}

/**
 * Formats location data for overlay display with simplified logic
 * Area mode: Most specific to least specific (suburb → city → town → municipality)
 * City mode: Broader to specific (municipality → city → town → suburb)  
 * State mode: State only (e.g., "Nevada" or "California")
 * Country mode: Country only (e.g., "United States" or "Japan")
 * Hidden mode: "Location Hidden"
 */
export function formatLocation(
  location: LocationData, 
  displayMode: 'city' | 'municipality' | 'state' | 'country' | 'hidden' = 'city'
): string {
  if (!location) return '';
  
  if (displayMode === 'hidden') {
    return 'Location Hidden';
  }
  
  if (displayMode === 'city') {
    // Area mode: Most specific to least specific (suburb → city → town → municipality)
    const cityPriority: (keyof LocationData)[] = ['suburb', 'city', 'town', 'municipality'];
    return getBestLocationName(location, cityPriority);
  }
  
  if (displayMode === 'municipality') {
    // City mode: Broader to specific (municipality → city → town → suburb)
    const municipalityPriority: (keyof LocationData)[] = ['municipality', 'city', 'town', 'suburb'];
    return getBestLocationName(location, municipalityPriority);
  }

  if (displayMode === 'state') {
    // State mode: State only
    if (location.state && location.state.length <= MAX_LOCATION_FIELD_LENGTH) {
      return location.state;
    }
    
    return shortenCountryName(location.country || '', location.countryCode || '');
  }

  if (displayMode === 'country') {
    // Country mode: Country only
    return shortenCountryName(location.country || '', location.countryCode || '');
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
  openmeteo: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 600 // 600 per minute (10 per second)
  },
  locationiq: { 
    calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 // 2 per second (free tier limit)
  },
  mapbox: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 30 // 30 per minute
  },
} as const;

/**
 * Checks if API call is within rate limits
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Check if limit reached
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

 