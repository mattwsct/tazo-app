// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_COUNTRY_NAME_LENGTH = 12;



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
  primary: string;  // Most precise available location
  context?: string; // Administrative context (only when not redundant)
}

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'neighborhood' | 'city' | 'state';

/**
 * Defines the fallback hierarchy for location precision levels
 * 
 * When a location at one level is redundant, we fall back to the next level:
 * neighborhood -> city -> state -> null (no more levels)
 */
const PRECISION_FALLBACKS: Record<LocationPrecision, LocationPrecision | null> = {
  neighborhood: 'city',    // If neighborhood is redundant, try city
  city: 'state',           // If city is redundant, try state  
  state: null              // State is the final level, no fallback
} as const;

// === 🔍 DUPLICATE DETECTION ===

/**
 * Checks if two location names are redundant (bidirectional containment)
 * Examples: "New York City" contains "New York" -> redundant
 *           "Tokyo Prefecture" contains "Tokyo" -> redundant
 */
function areRedundantNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  
  const lower1 = name1.toLowerCase().trim();
  const lower2 = name2.toLowerCase().trim();
  
  return lower1.includes(lower2) || lower2.includes(lower1);
}

// === 🗺️ LOCATION DATA EXTRACTION ===

/**
 * Gets the best location name for a given precision level
 * 
 * Simple fallback chain: try each field in order until we find one that exists and isn't too long.
 */
function getLocationByPrecision(location: LocationData, precision: LocationPrecision): string {
  const fieldChains = {
    neighborhood: [location.town, location.suburb, location.municipality, location.city, location.state],
    city: [location.municipality, location.city, location.state],
    state: [location.state]
  };
  
  const fields = fieldChains[precision];
  return fields.find(field => field && field.length <= 20) || '';
}

/**
 * Gets context for a location by finding the first non-redundant level
 * 
 * Simple logic: try each level in the fallback chain until we find one that's not redundant.
 */
function getContext(location: LocationData, primaryName: string, currentPrecision: LocationPrecision): string | null {
  const fallbackChain = getFallbackChain(currentPrecision);
  
  for (const precision of fallbackChain) {
    const levelName = getLocationByPrecision(location, precision);
    if (levelName && !areRedundantNames(primaryName, levelName)) {
      return levelName;
    }
  }
  
  return null;
}

/**
 * Gets the fallback chain for a given precision level
 * Example: neighborhood -> [city, state], city -> [state], state -> []
 */
function getFallbackChain(precision: LocationPrecision): LocationPrecision[] {
  const chain: LocationPrecision[] = [];
  let current = PRECISION_FALLBACKS[precision];
  
  while (current) {
    chain.push(current);
    current = PRECISION_FALLBACKS[current];
  }
  
  return chain;
}

// === 🌍 COUNTRY NAME FORMATTING ===

/**
 * Intelligently formats country names for display
 */
export function formatCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';
  
  // Common long country names that can be shortened
  const countryShortenings: Record<string, string> = {
    'united states of america': 'USA',
    'united states': 'USA',
    'united kingdom of great britain and northern ireland': 'UK',
    'united kingdom': 'UK',
    'russian federation': 'Russia',
    'peoples republic of china': 'China',
    'republic of south africa': 'South Africa',
    'federative republic of brazil': 'Brazil',
    'republic of india': 'India',
    'republic of indonesia': 'Indonesia',
    'kingdom of saudi arabia': 'Saudi Arabia',
    'republic of korea': 'South Korea',
    'democratic peoples republic of korea': 'North Korea',
    'republic of the philippines': 'Philippines',
    'socialist republic of vietnam': 'Vietnam',
    'kingdom of thailand': 'Thailand',
    'republic of turkey': 'Turkey',
    'islamic republic of iran': 'Iran',
    'republic of iraq': 'Iraq',
    'republic of egypt': 'Egypt',
    'republic of sudan': 'Sudan',
    'republic of south sudan': 'South Sudan',
    'republic of chad': 'Chad',
    'republic of niger': 'Niger',
    'republic of mali': 'Mali',
    'republic of burkina faso': 'Burkina Faso',
    'republic of senegal': 'Senegal',
    'republic of guinea': 'Guinea',
    'republic of sierra leone': 'Sierra Leone',
    'republic of liberia': 'Liberia',
    'republic of ivory coast': 'Ivory Coast',
    'republic of ghana': 'Ghana',
    'republic of togo': 'Togo',
    'republic of benin': 'Benin',
    'republic of nigeria': 'Nigeria',
    'republic of cameroon': 'Cameroon',
    'republic of central african republic': 'Central African Republic',
    'republic of congo': 'Congo',
    'democratic republic of the congo': 'DR Congo',
    'republic of gabon': 'Gabon',
    'republic of equatorial guinea': 'Equatorial Guinea',
    'republic of angola': 'Angola',
    'republic of zambia': 'Zambia',
    'republic of zimbabwe': 'Zimbabwe',
    'republic of botswana': 'Botswana',
    'republic of namibia': 'Namibia',
    'republic of mozambique': 'Mozambique',
    'republic of madagascar': 'Madagascar',
    'republic of mauritius': 'Mauritius',
    'republic of seychelles': 'Seychelles',
    'republic of comoros': 'Comoros',
    'republic of djibouti': 'Djibouti',
    'republic of somalia': 'Somalia',
    'republic of kenya': 'Kenya',
    'republic of uganda': 'Uganda',
    'republic of rwanda': 'Rwanda',
    'republic of burundi': 'Burundi',
    'republic of tanzania': 'Tanzania',
    'republic of malawi': 'Malawi',
    'republic of lesotho': 'Lesotho',
    'kingdom of eswatini': 'Eswatini'
  };
  
  if (countryName) {
    const lowerCountryName = countryName.toLowerCase();
    
    // Check if we have a shortening for this country
    if (countryShortenings[lowerCountryName]) {
      return countryShortenings[lowerCountryName];
    }
    
    // If the name is still too long, use country code
    if (countryName.length > MAX_COUNTRY_NAME_LENGTH) {
      return countryCode ? countryCode.toUpperCase() : countryName;
    }
    
    return countryName;
  }
  
  // If no country name but we have country code, return the code
  return countryCode ? countryCode.toUpperCase() : '';
}

// === 📏 UTILITY FUNCTIONS ===



/**
 * Gets the best city name by intelligently selecting the most appropriate city
 */
export function getBestCityName(location: LocationData): string {
  // Priority order for city names (API's preferred order)
  const cityCandidates = [
    location.city,           // Primary city field - trust the API's choice
    location.municipality,   // Municipality (often the main city for larger areas)
    location.town,           // Town (usually a proper city)
    location.suburb          // Suburb (last resort, often just neighborhood names)
  ].filter((city): city is string => Boolean(city));
  
  if (cityCandidates.length === 0) return '';
  if (cityCandidates.length === 1) return cityCandidates[0];
  
  // Check for redundant names with administrative suffixes
  for (let i = 0; i < cityCandidates.length; i++) {
    for (let j = i + 1; j < cityCandidates.length; j++) {
      if (areRedundantNames(cityCandidates[i], cityCandidates[j])) {
        // For compound names like "Las Vegas" vs "Vegas", prefer the compound name
        const isCompound1 = cityCandidates[i].includes(' ');
        const isCompound2 = cityCandidates[j].includes(' ');
        
        if (isCompound1 && !isCompound2) return cityCandidates[i];
        if (isCompound2 && !isCompound1) return cityCandidates[j];
        
        // For non-compound names, prefer the shorter one (likely the base name)
        return cityCandidates[i].length <= cityCandidates[j].length ? 
               cityCandidates[i] : cityCandidates[j];
      }
    }
  }
  
  // Default: Trust the API's prioritization
  return cityCandidates[0];
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
  
  return countryCode ? countryCode.toUpperCase() : '';
}

// === 🎨 MAIN LOCATION FORMATTING ===

/**
 * Formats location data for overlay display with two-line precision-based logic
 * 
 * @example
 * // Neighborhood mode: Shows most specific location with context
 * formatLocation({ town: "Hell's Kitchen", city: 'New York City', state: 'New York' }, 'neighborhood')
 * // Returns: { primary: "Hell's Kitchen", context: 'New York' }
 * 
 * @example
 * // City mode: Shows city with state context (if not duplicate)
 * formatLocation({ city: 'Tokyo', state: 'Tokyo Prefecture' }, 'city')
 * // Returns: { primary: 'Tokyo', context: undefined } (duplicate detected)
 * 
 * @example
 * // State mode: Shows state only (no country fallback)
 * formatLocation({ state: 'California', country: 'United States' }, 'state')
 * // Returns: { primary: 'California', context: undefined }
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'neighborhood' | 'city' | 'state' | 'hidden' | 'custom' = 'neighborhood'
): LocationDisplay {
  if (!location || displayMode === 'hidden' || displayMode === 'custom') return { primary: '', context: undefined };
  
  // Get primary location (automatically handles length limits via getLocationByPrecision)
  const primary = getLocationByPrecision(location, displayMode);
  if (!primary) return { primary: '', context: undefined };
  
  // Get context with duplicate detection
  const context = getContext(location, primary, displayMode);
  
  return {
    primary,
    context: context || undefined
  };
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

 