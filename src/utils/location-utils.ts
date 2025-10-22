// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_CHARACTER_LIMIT = 18; // Single limit for both primary and country lines

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
  neighbourhood?: string; // British spelling from LocationIQ
  county?: string; // Metropolitan area (e.g., Gold Coast)
  province?: string;
  region?: string;
  house_number?: string;
  road?: string;
  postcode?: string;
  // Additional fields that may appear in LocationIQ responses
  village?: string;
  hamlet?: string;
  district?: string;
  ward?: string;
  borough?: string;
  quarter?: string;
}

export interface LocationDisplay {
  primary: string;  // Most precise available location
  country?: string; // Country name/code (no dedupe vs primary)
}

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'neighborhood' | 'city';


// === 🔍 SIMPLE FILTERING ===

/**
 * Simple validation for location names
 * Skips: empty names, names ending with numbers (technical addresses), names too long
 */
function isValidLocationName(name: string): boolean {
  if (!name || name.length > MAX_CHARACTER_LIMIT) {
    return false;
  }
  
  // Skip if it's just a number (like "123", "5")
  if (/^\d+$/.test(name.trim())) {
    return false;
  }
  
  // Skip if it ends with a space and number (like "Honmachi 3", "Block 12")
  // But keep names with numbers in the middle (like "4th Avenue", "21st Street")
  if (/\s+\d+$/.test(name.trim())) {
    return false;
  }
  
  return true;
}


// === 🗺️ LOCATION DATA EXTRACTION ===

/**
 * Gets the best location name for a given precision level with quality-based selection
 * 
 * Uses simple filtering to skip names with numbers, empty fields, and long names.
 */
function getLocationByPrecision(location: LocationData, precision: LocationPrecision): string {
  const getField = (fields: (keyof LocationData)[]): string => {
    for (const field of fields) {
      const value = location[field] as string | undefined;
      if (value && isValidLocationName(value)) {
        return value;
      }
    }
    return '';
  };

  let keysToUse: (keyof LocationData)[];
  
  if (precision === 'neighborhood') {
    // Most specific meaningful location
    keysToUse = ['neighbourhood', 'quarter', 'ward', 'suburb', 'district', 'city'];
  } else { // city
    // City level location
    keysToUse = ['city', 'municipality', 'district'];
  }

  return getField(keysToUse);
}

/**
 * Gets country for a location with 16-character limit
 * 
 * Rules:
 * - Always show country name if it fits (≤16 chars)
 * - If country name is too long, show country code
 * - No dedupe checks needed
 */
function getCountry(location: LocationData): string | null {
  const countryCode = (location.countryCode || '').toUpperCase();
  const countryName = location.country || '';
  
  // Always try country name first if it exists
  if (countryName) {
    if (countryName.length <= MAX_CHARACTER_LIMIT) {
      return countryName;
    }
  }
  
  // If country name is too long, use country code
  if (countryCode) {
    return countryCode;
  }
  
  return null;
}


// === 🌍 COUNTRY NAME FORMATTING ===

/**
 * Intelligently formats country names for display
 */
export function formatCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';
  
  // Only shorten the most common long country names
  const commonShortenings: Record<string, string> = {
    'united states of america': 'USA',
    'united states': 'USA',
    'united kingdom of great britain and northern ireland': 'UK',
    'united kingdom': 'UK',
    'russian federation': 'Russia',
    'democratic republic of the congo': 'DR Congo'
  };
  
  if (countryName) {
    const lowerCountryName = countryName.toLowerCase();
    
    // Check if we have a shortening for this country
    if (commonShortenings[lowerCountryName]) {
      return commonShortenings[lowerCountryName];
    }
    
    // If the name is too long, use country code
    if (countryName.length > MAX_CHARACTER_LIMIT) {
      return countryCode ? countryCode.toUpperCase() : countryName;
    }
    
    return countryName;
  }
  
  // If no country name but we have country code, return the code
  return countryCode ? countryCode.toUpperCase() : '';
}

// === 📏 UTILITY FUNCTIONS ===

/**
 * Gets the best city name by selecting the first available city field
 */
export function getBestCityName(location: LocationData): string {
  // Simple priority order for city names
  return location.city || 
         location.municipality || 
         location.town || 
         location.suburb || 
         '';
}

/**
 * Shortens country name if too long, otherwise uses country code
 */
export function shortenCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';
  
  if (countryName && countryName.length <= MAX_CHARACTER_LIMIT) {
    return countryName;
  }
  
  if (countryName && countryName.length > MAX_CHARACTER_LIMIT) {
    return countryCode ? countryCode.toUpperCase() : countryName;
  }
  
  return countryCode ? countryCode.toUpperCase() : '';
}

// === 🎨 MAIN LOCATION FORMATTING ===

/**
 * Formats location data for overlay display with 16-character limits
 * 
 * Rules:
 * - Precise: Shows most specific location with country
 * - Broad: Shows broader location with country
 * - Region: Shows state/province with country
 * - Country line: Country name if ≤16 chars, else country code
 * 
 * @example
 * // City mode: Shows city with state/country context
 * formatLocation({ city: 'Tokyo', state: 'Tokyo', country: 'Japan', countryCode: 'JP' }, 'city')
 * // Returns: { primary: 'Tokyo', context: 'JP' } (duplicate state detected)
 * 
 * @example
 * // City mode: Shows city with state and country code
 * formatLocation({ city: 'San Francisco', state: 'California', country: 'USA', countryCode: 'US' }, 'city')
 * // Returns: { primary: 'San Francisco', context: 'California, US' }
 * 
 * @example
 * // State mode: Shows state with country code
 * formatLocation({ state: 'California', country: 'USA', countryCode: 'US' }, 'state')
 * // Returns: { primary: 'California', context: 'US' }
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'neighborhood' | 'city' | 'custom' | 'hidden' = 'neighborhood'
): LocationDisplay {
  if (!location || displayMode === 'hidden') return { primary: '', country: undefined };
  
  // For custom mode, we still need the country name/flag, just not the primary location
  if (displayMode === 'custom') {
    const country = getCountry(location);
    return { primary: '', country: country || undefined };
  }
  
  const primary = getLocationByPrecision(location, displayMode);
  if (!primary) return { primary: '', country: undefined };
  
  const country = getCountry(location);
  
  return {
    primary,
    country: country || undefined
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
