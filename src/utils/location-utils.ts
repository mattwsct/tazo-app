// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_CHARACTER_LIMIT = 20; // Single limit for both primary and country lines

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
  country?: string; // Country name with flag (Line 2)
  countryCode?: string; // ISO country code for flag display
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
 * Gets the best location name for a given precision level with automatic fallback
 * 
 * If the requested precision level has names that are too long (>20 chars),
 * it automatically falls back to the next less specific level.
 * 
 * Fallback hierarchy:
 * - neighborhood: neighborhood/suburb/ward → city/town → county → state/province → country
 * - city: city/town → county → state/province → country
 * 
 * Both modes share the same fallback chain (city → county → state/province).
 * Neighborhood mode adds neighborhood fields at the beginning for more precision.
 * 
 * Global compatibility:
 * - Works worldwide as LocationIQ provides country-appropriate fields
 * - County is optional (doesn't exist in Japan, many EU countries)
 * - Field names vary by country but hierarchy is generally consistent
 * - Only area-based locations are used (no street addresses/road names)
 */
function getLocationByPrecision(location: LocationData, precision: LocationPrecision): string {
  // Try to find a valid name at the current precision level
  const tryFields = (fields: (keyof LocationData)[]): string | null => {
    for (const field of fields) {
      const value = location[field] as string | undefined;
      if (value && isValidLocationName(value)) {
        return value;
      }
    }
    return null;
  };

  // Define fields for each specificity level (only area-based, no street addresses)
  // These fields are ordered by typical specificity globally, though exact hierarchy varies by country
  // 
  // Neighborhood: Smallest local areas within cities (e.g., "Downtown", "SoHo", "Shinjuku")
  // Order: Most common first (neighbourhood), then administrative divisions (ward, borough), then districts/suburbs
  const neighborhoodFields: (keyof LocationData)[] = ['neighbourhood', 'quarter', 'ward', 'borough', 'district', 'suburb'];
  // 
  // City: Settlements and urban areas (towns, villages, cities, municipalities)
  // Order: Most recognizable first (city), then administrative names (municipality), then smaller settlements
  // NOTE: Suburb is NOT included here - it's a neighborhood field, not a city field
  // This ensures City mode shows actual city names (e.g., "Austin") not neighborhoods (e.g., "Downtown")
  const cityProperFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet'];
  // 
  // County: Administrative divisions between city and state (may not exist in all countries)
  // Examples: US counties, UK counties, Australian LGAs
  const countyFields: (keyof LocationData)[] = ['county'];
  // 
  // State: Large administrative divisions (states, provinces, regions, prefectures)
  // Order: Province first (covers Japanese prefectures, Canadian provinces), then state, then region
  // NOTE: County is NOT included here - it's a separate administrative level
  const stateFields: (keyof LocationData)[] = ['province', 'state', 'region'];
  
  // Both modes share the same fallback chain: city → county → state/province
  // Neighborhood mode adds neighborhood fields at the beginning for more precision
  // Note: County is optional and will be skipped if not present in the location data
  
  if (precision === 'neighborhood') {
    // Most specific: try neighborhood/local areas first
    // These vary by country: suburb (AU/UK), ward (UK/JP), district (many), neighbourhood (US)
    const neighborhoodName = tryFields(neighborhoodFields);
    if (neighborhoodName) return neighborhoodName;
    
    // Then fall through to shared fallback chain (city → county → state)
  }
    
  // Shared fallback chain for both modes: city → county → state/province
  // This works globally as LocationIQ provides appropriate fields for each country
    const cityName = tryFields(cityProperFields);
    if (cityName) return cityName;
    
  // County may not exist in all countries (e.g., Japan uses prefectures, many EU countries skip this level)
  // If present, it's typically between city and state/province in the hierarchy
  const countyName = tryFields(countyFields);
  if (countyName) return countyName;
    
  // State/province/region level (exists in most countries: US states, Japanese prefectures, EU regions, etc.)
    const stateName = tryFields(stateFields);
    if (stateName) return stateName;

  // If nothing worked, return empty (will use country as last resort in formatLocation)
  return '';
}

/**
 * Gets country for a location with character limit and smart shortening
 * 
 * Rules:
 * - If name fits (≤20 chars), use it
 * - If too long, try smart shortening (e.g., "USA", "UK", "DR Congo")
 * - As last resort, use country code
 * 
 * Returns both the formatted country and whether it was abbreviated
 */
function getCountry(location: LocationData): { country: string; wasAbbreviated: boolean } | null {
  const countryCode = (location.countryCode || '').toUpperCase();
  const countryName = location.country || '';
  
  if (!countryName && !countryCode) return null;
  
  // Use the smart formatting function which handles shortenings
  const formatted = formatCountryName(countryName, countryCode);
  if (!formatted) return null;
  
  // Check if it was abbreviated (formatted is different from original)
  const wasAbbreviated = formatted.toLowerCase() !== countryName.toLowerCase();
  
  return { country: formatted, wasAbbreviated };
}


// === 🌍 COUNTRY NAME FORMATTING ===

/**
 * Intelligently formats country names for display
 */
export function formatCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';
  
  // Smart shortening for common long country names (keeping them readable)
  const commonShortenings: Record<string, string> = {
    'united states of america': 'USA',
    'united states': 'USA',
    'united kingdom of great britain and northern ireland': 'UK',
    'united kingdom': 'UK',
    'russian federation': 'Russia',
    'democratic republic of the congo': 'DR Congo',
    'republic of the congo': 'Congo',
    'czech republic': 'Czechia',
    'dominican republic': 'Dominican Rep.',
    'united arab emirates': 'UAE',
    'bosnia and herzegovina': 'Bosnia',
    'trinidad and tobago': 'Trinidad & Tobago',
    'saint vincent and the grenadines': 'St. Vincent',
    'sao tome and principe': 'São Tomé',
    'antigua and barbuda': 'Antigua',
    'saint kitts and nevis': 'St. Kitts',
    'central african republic': 'CAR'
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
 * Note: Excludes suburb as suburbs are neighborhoods, not cities
 */
export function getBestCityName(location: LocationData): string {
  // Simple priority order for city names (excludes suburb - that's a neighborhood)
  return location.city || 
         location.municipality || 
         location.town || 
         location.village ||
         location.hamlet ||
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
 * Formats location data for overlay display with 20-character limits
 * 
 * Rules:
 * - Precise: Shows most specific location with country
 * - Broad: Shows broader location with country
 * - Region: Shows state/province with country
 * - Country line: Country name if ≤20 chars, else country code
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
 * // Country mode: Shows country (and state if country was abbreviated)
 * formatLocation({ state: 'California', country: 'United States of America', countryCode: 'US' }, 'country')
 * // Returns: { primary: '', country: 'California, USA', countryCode: 'US' }
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'neighborhood' | 'city' | 'country' | 'custom' | 'hidden' = 'neighborhood'
): LocationDisplay {
  if (!location || displayMode === 'hidden') return { primary: '', country: undefined };
  
  // For country mode, show only country name/flag (no primary location)
  if (displayMode === 'country') {
    const countryInfo = getCountry(location);
    const countryDisplay = countryInfo ? formatCountryWithState(location, countryInfo) : undefined;
    return { primary: '', country: countryDisplay, countryCode: location.countryCode || '' };
  }
  
  // For custom mode, we still need the country name/flag, just not the primary location
  if (displayMode === 'custom') {
    const countryInfo = getCountry(location);
    const countryDisplay = countryInfo ? formatCountryWithState(location, countryInfo) : undefined;
    return { primary: '', country: countryDisplay, countryCode: location.countryCode || '' };
  }
  
  const primary = getLocationByPrecision(location, displayMode);
  const countryInfo = getCountry(location);
  
  // If no primary location found, still show country on line 2 if available
  if (!primary) {
    if (countryInfo) {
      const countryDisplay = formatCountryWithState(location, countryInfo);
      return { 
        primary: '', // Line 1 stays blank
        country: countryDisplay, // Line 2 shows country with flag
        countryCode: location.countryCode || ''
      };
    }
    // No location data at all
    return { primary: '', country: undefined };
  }
  
  // Check for duplicate names (e.g., "Singapore, Singapore" or "Monaco, Monaco")
  // If primary matches country, hide primary and show only country with flag on line 2
  if (countryInfo && primary.toLowerCase() === countryInfo.country.toLowerCase()) {
    const countryDisplay = formatCountryWithState(location, countryInfo);
    return {
      primary: '', // Hide duplicate on line 1
      country: countryDisplay, // Show country with flag on line 2
      countryCode: location.countryCode || ''
    };
  }
  
  // Also check if primary matches state when state is shown in country display
  // This prevents duplicates like "Texas" with "Texas, USA"
  // In this case, show the state as primary and just the country (without state) on line 2
  if (countryInfo && countryInfo.wasAbbreviated) {
    const state = location.state || location.province || location.region;
    if (state && primary.toLowerCase() === state.toLowerCase()) {
      // Primary matches state, and state would be shown in country display
      // Show state as primary and just country (without state) to avoid duplication
      return {
        primary, // Show state on line 1
        country: countryInfo.country, // Show just country on line 2 (state already shown on line 1)
        countryCode: location.countryCode || ''
      };
    }
  }
  
  // Special handling for Neighborhood mode: if primary is a neighborhood, show city context instead of state/country
  // This prevents nonsensical displays like "Downtown, Texas, US" and instead shows "Downtown" with "Austin, US"
  if (displayMode === 'neighborhood') {
    // Check if primary came from a neighborhood field (not city/state/county fallback)
    const neighborhoodFields: (keyof LocationData)[] = ['neighbourhood', 'quarter', 'ward', 'borough', 'district', 'suburb'];
    const isNeighborhoodField = neighborhoodFields.some(field => {
      const value = location[field] as string | undefined;
      return value && value.toLowerCase() === primary.toLowerCase();
    });
    
    if (isNeighborhoodField) {
      // Primary is a neighborhood - show city context on line 2 instead of state/country
      // Try to get city name using the same validation logic
      const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet'];
      let cityName: string | null = null;
      for (const field of cityFields) {
        const value = location[field] as string | undefined;
        if (value && isValidLocationName(value)) {
          cityName = value;
          break;
        }
      }
      
      if (cityName) {
        // We have a city name - format as "City, State" or "City, Country Code" (max 2 categories)
        const cityDisplay = formatCityWithContext(location, cityName, countryInfo);
        return {
          primary,
          country: cityDisplay,
          countryCode: location.countryCode || ''
        };
      }
      // No city available - fall back to normal state/country display
    }
  }
  
  // Normal case: show location with country context
  const countryDisplay = countryInfo ? formatCountryWithState(location, countryInfo) : undefined;
  return {
    primary,
    country: countryDisplay,
    countryCode: location.countryCode || ''
  };
}

/**
 * Formats city display with country context for Neighborhood mode
 * Limited to maximum 2 categories: "City, State" or "City, Country Code"
 */
function formatCityWithContext(
  location: LocationData,
  cityName: string,
  countryInfo: { country: string; wasAbbreviated: boolean } | null
): string {
  if (!countryInfo) {
    return cityName; // Just city if no country info
  }
  
  const { country } = countryInfo;
  const countryCode = location.countryCode || '';
  
  // Priority 1: Try "City, State" format (2 categories)
  const state = location.state || location.province || location.region;
  if (state) {
    const withState = `${cityName}, ${state}`;
    if (withState.length <= MAX_CHARACTER_LIMIT) {
      return withState;
    }
  }
  
  // Priority 2: Try "City, Country Code" format (2 categories)
  // Use country code instead of full country name for brevity
  if (countryCode) {
    const withCountryCode = `${cityName}, ${countryCode.toUpperCase()}`;
    if (withCountryCode.length <= MAX_CHARACTER_LIMIT) {
      return withCountryCode;
    }
  }
  
  // Priority 3: Try "City, Country" format (2 categories) if country name is short
  const withCountry = `${cityName}, ${country}`;
  if (withCountry.length <= MAX_CHARACTER_LIMIT) {
    return withCountry;
  }
  
  // Priority 4: If state exists but city+state doesn't fit, try "State, Country Code"
  if (state && countryCode) {
    const stateWithCountryCode = `${state}, ${countryCode.toUpperCase()}`;
    if (stateWithCountryCode.length <= MAX_CHARACTER_LIMIT) {
      return stateWithCountryCode;
    }
  }
  
  // Fallback: Just city (truncate if needed)
  return cityName.length <= MAX_CHARACTER_LIMIT ? cityName : cityName.substring(0, MAX_CHARACTER_LIMIT - 3) + '...';
}

/**
 * Formats country display, optionally including state when country is abbreviated
 * Limited to maximum 2 categories: "State, Country Code" or "State, Country"
 * 
 * Rules:
 * - If country was abbreviated (e.g., "USA", "UK") and state exists, try "State, Country Code" (preferred) or "State, Country"
 * - If that fits in 20 chars, use it
 * - Otherwise, just show country or country code
 */
function formatCountryWithState(
  location: LocationData, 
  countryInfo: { country: string; wasAbbreviated: boolean }
): string {
  const { country, wasAbbreviated } = countryInfo;
  const countryCode = location.countryCode || '';
  
  // Try to get state/province/region
  const state = location.state || location.province || location.region;
  
  // If country was abbreviated and state exists, try 2-category formats
  if (wasAbbreviated && state) {
    // Priority 1: "State, Country Code" (2 categories, most concise)
    if (countryCode) {
      const stateWithCountryCode = `${state}, ${countryCode.toUpperCase()}`;
      if (stateWithCountryCode.length <= MAX_CHARACTER_LIMIT) {
        return stateWithCountryCode;
      }
    }
    
    // Priority 2: "State, Country" (2 categories)
    const withState = `${state}, ${country}`;
    if (withState.length <= MAX_CHARACTER_LIMIT) {
      return withState;
    }
  }
  
  // If no state or country wasn't abbreviated, show single category
  // Prefer country code if available and country name is long
  if (countryCode && country.length > MAX_CHARACTER_LIMIT) {
    return countryCode.toUpperCase();
  }
  
  return country;
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
