// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_COUNTRY_NAME_LENGTH = 12;
const MAX_LOCATION_FIELD_LENGTH = 20;

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

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'suburb' | 'city' | 'state';

interface PrecisionFallback {
  precision: LocationPrecision;
  fallback: LocationPrecision | null;
}

const PRECISION_FALLBACKS: Record<LocationPrecision, PrecisionFallback> = {
  suburb: { precision: 'suburb', fallback: 'city' },
  city: { precision: 'city', fallback: 'state' },
  state: { precision: 'state', fallback: null }
} as const;

// === 🔍 DUPLICATE DETECTION ===

interface DuplicateCheckResult {
  isDuplicate: boolean;
  fallbackLevel: string | null;
}

/**
 * Checks if two location names are redundant (e.g., "Tokyo" and "Tokyo Prefecture")
 */
function areRedundantNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  
  const lower1 = name1.toLowerCase().trim();
  const lower2 = name2.toLowerCase().trim();
  
  // Exact match
  if (lower1 === lower2) return true;
  
  // Check if one name is contained within the other (e.g., "Vegas" in "Las Vegas")
  if (lower1.includes(lower2) || lower2.includes(lower1)) {
    // But be careful not to flag legitimate cases like "New York" vs "York"
    // Only flag if the shorter name is 3+ characters and the longer name is significantly longer
    const shorter = lower1.length <= lower2.length ? lower1 : lower2;
    const longer = lower1.length <= lower2.length ? lower2 : lower1;
    
    if (shorter.length >= 3 && longer.length >= shorter.length + 2) {
      return true;
    }
  }
  
  // Common redundant patterns with administrative suffixes
  const redundantSuffixes = [
    'prefecture', 'province', 'county', 'district', 'city', 'municipality',
    'state', 'region', 'territory', 'autonomous region', 'special region'
  ];
  
  for (const suffix of redundantSuffixes) {
    // Check if one is just the other + suffix (e.g., "Tokyo" vs "Tokyo Prefecture")
    if ((lower1 === lower2.replace(` ${suffix}`, '')) || 
        (lower2 === lower1.replace(` ${suffix}`, ''))) {
      return true;
    }
    
    // Check for variations with common separators
    if ((lower1 === lower2.replace(`-${suffix}`, '')) || 
        (lower2 === lower1.replace(`-${suffix}`, ''))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Checks for duplicate names and returns appropriate fallback level
 */
function checkForDuplicates(
  primaryName: string, 
  secondaryName: string, 
  currentPrecision: LocationPrecision,
  location: LocationData
): DuplicateCheckResult {
  if (!areRedundantNames(primaryName, secondaryName)) {
    return { isDuplicate: false, fallbackLevel: null };
  }
  
  // Handle different precision levels with appropriate fallbacks
  switch (currentPrecision) {
    case 'suburb':
      return { isDuplicate: true, fallbackLevel: location.state || null };
    
    case 'city':
      return { 
        isDuplicate: true, 
        fallbackLevel: location.country ? formatCountryName(location.country, location.countryCode) : null 
      };
    
    case 'state':
      return { 
        isDuplicate: true, 
        fallbackLevel: location.country ? formatCountryName(location.country, location.countryCode) : null 
      };
    
    default:
      return { isDuplicate: false, fallbackLevel: null };
  }
}

// === 🗺️ LOCATION DATA EXTRACTION ===

/**
 * Gets location data by precision level with smart fallbacks
 */
function getLocationByPrecision(location: LocationData, precision: LocationPrecision): string {
  const fallbackChain = {
    suburb: [location.suburb, location.city, location.town, location.municipality, location.state],
    city: [location.city, location.town, location.municipality, location.state],
    state: [location.state]
  };
  
  return fallbackChain[precision].find(Boolean) || '';
}

/**
 * Gets the next administrative level up for context
 */
function getNextAdministrativeLevel(location: LocationData, currentPrecision: LocationPrecision): string | null {
  const { fallback } = PRECISION_FALLBACKS[currentPrecision];
  
  if (!fallback) {
    // State level - try to add country as context
    return location.country ? formatCountryName(location.country, location.countryCode) : null;
  }
  
  const nextLevel = getLocationByPrecision(location, fallback);
  if (!nextLevel) return null;
  
  // Check for duplicates and get appropriate fallback
  const primaryName = getLocationByPrecision(location, currentPrecision);
  const duplicateCheck = checkForDuplicates(primaryName, nextLevel, currentPrecision, location);
  
  if (duplicateCheck.isDuplicate) {
    return duplicateCheck.fallbackLevel;
  }
  
  return nextLevel;
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
 * Checks if a location name is too long for display
 */
function isLocationNameTooLong(name: string): boolean {
  return name.length > MAX_LOCATION_FIELD_LENGTH;
}

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
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'suburb' | 'city' | 'state' | 'hidden' = 'suburb'
): LocationDisplay {
  // Early returns for edge cases
  if (!location) return { line1: '', line2: undefined };
  if (displayMode === 'hidden') return { line1: 'Location Hidden', line2: undefined };
  
  // Get primary location and handle length-based fallbacks
  const primaryLocation = getLocationByPrecision(location, displayMode);
  let nextLevel: string | null = null;
  
  // Handle length-based fallbacks
  if (primaryLocation && isLocationNameTooLong(primaryLocation)) {
    const fallbackResult = handleLengthBasedFallback(location, displayMode);
    if (fallbackResult) {
      return fallbackResult;
    }
  }
  
  // Handle missing primary location fallbacks
  if (!primaryLocation) {
    const missingFallbackResult = handleMissingPrimaryFallback(location, displayMode);
    if (missingFallbackResult) {
      return missingFallbackResult;
    }
    return { line1: '', line2: undefined };
  }
  
  // Get next level if not already set
  if (nextLevel === null) {
    nextLevel = getNextAdministrativeLevel(location, displayMode);
  }
  
  return {
    line1: primaryLocation,
    line2: nextLevel || undefined
  };
}

/**
 * Handles fallbacks when primary location is too long
 */
function handleLengthBasedFallback(
  location: LocationData, 
  displayMode: LocationPrecision
): LocationDisplay | null {
  const { fallback } = PRECISION_FALLBACKS[displayMode];
  
  if (!fallback) return null;
  
  const fallbackLocation = getLocationByPrecision(location, fallback);
  if (!fallbackLocation || isLocationNameTooLong(fallbackLocation)) {
    // Try next fallback level
    const nextFallback = PRECISION_FALLBACKS[fallback]?.fallback;
    if (nextFallback) {
      const nextFallbackLocation = getLocationByPrecision(location, nextFallback);
      if (nextFallbackLocation && !isLocationNameTooLong(nextFallbackLocation)) {
        return { line1: nextFallbackLocation, line2: undefined };
      }
    }
    
    // Fall back to original precision but single line only
    const originalLocation = getLocationByPrecision(location, displayMode);
    return { line1: originalLocation, line2: undefined };
  }
  
  // Use fallback level
  const nextLevel = getNextAdministrativeLevel(location, fallback);
  return {
    line1: fallbackLocation,
    line2: nextLevel || undefined
  };
}

/**
 * Handles fallbacks when primary location is missing
 */
function handleMissingPrimaryFallback(
  location: LocationData, 
  displayMode: LocationPrecision
): LocationDisplay | null {
  const { fallback } = PRECISION_FALLBACKS[displayMode];
  
  if (!fallback) return null;
  
  const fallbackLocation = getLocationByPrecision(location, fallback);
  if (fallbackLocation) {
    const nextLevel = getNextAdministrativeLevel(location, fallback);
    return {
      line1: fallbackLocation,
      line2: nextLevel || undefined
    };
  }
  
  // Try next fallback level
  const nextFallback = PRECISION_FALLBACKS[fallback]?.fallback;
  if (nextFallback) {
    const nextFallbackLocation = getLocationByPrecision(location, nextFallback);
    if (nextFallbackLocation) {
      return { line1: nextFallbackLocation, line2: undefined };
    }
  }
  
  return null;
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

 