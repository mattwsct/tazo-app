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

type LocationPrecision = 'neighbourhood' | 'city' | 'state';

// Category types to track which location category was used
type LocationCategory = 'neighbourhood' | 'city' | 'county' | 'state' | 'country';


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
 * Returns both the location name and the category it came from
 * 
 * If the requested precision level has names that are too long (>20 chars),
 * it automatically falls back to the next less specific level.
 * 
 * Fallback hierarchy:
 * - neighbourhood: neighbourhood/suburb/ward → city/town → state → country
 * - city: city/town → state → country
 * - state: state/province/prefecture/region/county → country
 * 
 * Both modes share the same fallback chain (city → state).
 * Neighbourhood mode adds neighbourhood fields at the beginning for more precision.
 * 
 * Global compatibility:
 * - Works worldwide as LocationIQ provides country-appropriate fields
 * - State category includes: state, province (prefectures), region, county
 * - Field names vary by country but hierarchy is generally consistent
 * - Only area-based locations are used (no street addresses/road names)
 */
function getLocationByPrecision(
  location: LocationData, 
  precision: LocationPrecision
): { name: string; category: LocationCategory } {
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

  // === CATEGORY DEFINITIONS ===
  // Each category contains specific fields from LocationIQ API, ordered by priority
  
  // NEIGHBOURHOOD: Smallest local areas within cities
  // Fields: neighbourhood, quarter, ward, borough, district, suburb
  const neighbourhoodFields: (keyof LocationData)[] = ['neighbourhood', 'quarter', 'ward', 'borough', 'district', 'suburb'];
  
  // CITY: Settlements and urban areas
  // Fields: city, municipality, town, village, hamlet
  // NOTE: Suburb is NOT included - it's a neighbourhood field, not a city field
  const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet'];
  
  // STATE: Large administrative divisions (includes states, provinces, prefectures, regions, counties)
  // Fields: state, province, region, county
  // Priority: state → province (prefectures) → region → county
  const stateFields: (keyof LocationData)[] = ['state', 'province', 'region', 'county'];
  
  // Fallback hierarchy: neighbourhood → city → state → country
  // Each precision level tries its category first, then falls back to next broadest if no valid names exist
  
  if (precision === 'neighbourhood') {
    // Try neighbourhood fields first
    const neighbourhoodName = tryFields(neighbourhoodFields);
    if (neighbourhoodName) return { name: neighbourhoodName, category: 'neighbourhood' };
    
    // Fallback to city if no neighbourhood found
    const cityName = tryFields(cityFields);
    if (cityName) return { name: cityName, category: 'city' };
    
    // Fallback to state if no city found
    const stateName = tryFields(stateFields);
    if (stateName) return { name: stateName, category: 'state' };
    
    // If nothing worked, return empty (will use country as last resort in formatLocation)
    return { name: '', category: 'country' };
  }
  
  if (precision === 'city') {
    // Try city fields first
    const cityName = tryFields(cityFields);
    if (cityName) return { name: cityName, category: 'city' };
    
    // Fallback to state if no city found
    const stateName = tryFields(stateFields);
    if (stateName) return { name: stateName, category: 'state' };
    
    // If nothing worked, return empty (will use country as last resort in formatLocation)
    return { name: '', category: 'country' };
  }
  
  if (precision === 'state') {
    // Try state category fields (state, province, region, county)
    const stateName = tryFields(stateFields);
    if (stateName) return { name: stateName, category: 'state' };
    
    // If nothing worked, return empty (will use country as last resort in formatLocation)
    return { name: '', category: 'country' };
  }

  // Unknown precision, return empty
  return { name: '', category: 'country' };
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
  // Strategy: Use common abbreviations/accepted short names, but keep them readable (not just codes)
  // For countries >20 chars, we provide readable shortenings that are still recognizable
  const commonShortenings: Record<string, string> = {
    // Very long names (>25 chars) - use common abbreviations
    'united kingdom of great britain and northern ireland': 'United Kingdom',
    'united states of america': 'United States',
    'democratic republic of the congo': 'DR Congo',
    'saint vincent and the grenadines': 'St. Vincent',
    'central african republic': 'Central Africa',
    
    // Long names (20-25 chars) - use readable shortenings
    'united states': 'United States',
    'united kingdom': 'United Kingdom',
    'bosnia and herzegovina': 'Bosnia',
    'russian federation': 'Russia',
    
    // Medium-long names - use common short forms
    'republic of the congo': 'Congo',
    'czech republic': 'Czechia',
    'dominican republic': 'Dominican Rep.',
    'united arab emirates': 'UAE',
    'trinidad and tobago': 'Trinidad & Tobago',
    'sao tome and principe': 'São Tomé',
    'antigua and barbuda': 'Antigua',
    'saint kitts and nevis': 'St. Kitts',
    'papua new guinea': 'Papua New Guinea', // 16 chars - OK
    'sri lanka': 'Sri Lanka', // 9 chars - OK
    'south africa': 'South Africa', // 12 chars - OK
    'new zealand': 'New Zealand', // 11 chars - OK
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
 * Checks if two location names overlap (one contains the other)
 * Used to prevent duplicate names like "Downtown Los Angeles" + "Los Angeles"
 * or "Tokyo" + "Tokyo Prefecture"
 * 
 * @param name1 First location name
 * @param name2 Second location name
 * @returns true if one name contains the other (case-insensitive)
 */
function hasOverlappingNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  
  const normalized1 = name1.toLowerCase().trim();
  const normalized2 = name2.toLowerCase().trim();
  
  // Check if one contains the other (as a whole word or exact match)
  // This catches cases like:
  // - "Downtown Los Angeles" contains "Los Angeles"
  // - "Tokyo" is contained in "Tokyo Prefecture"
  // - "Los Angeles" contains "Los Angeles" (exact match)
  
  // Split into words for more accurate matching
  const words1 = normalized1.split(/\s+/);
  const words2 = normalized2.split(/\s+/);
  
  // Check if all words from the shorter name appear in the longer name
  const shorter = words1.length <= words2.length ? words1 : words2;
  const longer = words1.length > words2.length ? words1 : words2;
  
  // If shorter name has all its words in longer name, they overlap
  if (shorter.length > 0 && shorter.every(word => longer.includes(word))) {
    return true;
  }
  
  // Also check simple substring match (catches exact matches and simple containment)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return true;
  }
  
  return false;
}

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
  displayMode: 'neighbourhood' | 'city' | 'state' | 'country' | 'custom' | 'hidden' = 'neighbourhood'
): LocationDisplay {
  if (!location || displayMode === 'hidden') return { primary: '', country: undefined };
  
  // For country mode, show only shortened country name/flag (no primary location, no state)
  if (displayMode === 'country') {
    const countryInfo = getCountry(location);
    // Use shortened country name directly, not state+country format
    const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', country: countryDisplay, countryCode: location.countryCode || '' };
  }
  
  // For custom mode, we still need the country name/flag, just not the primary location
  if (displayMode === 'custom') {
    const countryInfo = getCountry(location);
    const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', country: countryDisplay, countryCode: location.countryCode || '' };
  }
  
  // For state mode, show state on line 1 and country on line 2
  if (displayMode === 'state') {
    const primaryResult = getLocationByPrecision(location, 'state');
    const primary = primaryResult.name;
    const primaryCategory = primaryResult.category;
    const countryInfo = getCountry(location);
    
    // If no state found, fallback to showing country only
    if (!primary) {
      if (countryInfo) {
        // When state mode is selected, second line should only show country
        const countryDisplay = formatCountryName(countryInfo.country, location.countryCode || '');
        return { 
          primary: '', // Line 1 stays blank
          country: countryDisplay, // Line 2 shows country with flag
          countryCode: location.countryCode || ''
        };
      }
      return { primary: '', country: undefined };
    }
    
    // Show state on line 1, country ONLY on line 2 (exclude state from second line)
    // When state mode is selected, second line should only show country, not state or other broader options
    // Check for duplicate names (e.g., if state name overlaps with country name)
    const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    // If state and country names overlap, hide the duplicate
    if (countryDisplay && hasOverlappingNames(primary, countryDisplay)) {
      return {
        primary: primary,
        country: undefined, // Hide duplicate country on line 2
        countryCode: location.countryCode || ''
      };
    }
    return {
      primary: primary,
      country: countryDisplay,
      countryCode: location.countryCode || ''
    };
  }
  
  const primaryResult = getLocationByPrecision(location, displayMode);
  const primary = primaryResult.name;
  const primaryCategory = primaryResult.category;
  const countryInfo = getCountry(location);
  
  // If no primary location found, still show next broadest category on line 2 if available
  // Use the requested display mode to determine what should be on the second line
  // This ensures fallback logic works correctly: if neighbourhood was requested but not found,
  // second line should still show city (next broadest after neighbourhood), not what was actually found
  if (!primary) {
    const requestedCategory = displayMode === 'neighbourhood' ? 'neighbourhood' : 
                              displayMode === 'city' ? 'city' : 
                              displayMode === 'state' ? 'state' : 'country';
    const nextBroadestCategory = getNextBroadestCategory(location, requestedCategory, '');
    if (nextBroadestCategory) {
      return { 
        primary: '', // Line 1 stays blank
        country: nextBroadestCategory, // Line 2 shows next broadest category
        countryCode: location.countryCode || ''
      };
    }
    // No location data at all
    return { primary: '', country: undefined };
  }
  
  // Check for duplicate names (e.g., "Singapore, Singapore" or "Monaco, Monaco")
  // If primary matches country, hide primary and show only country with flag on line 2
  if (countryInfo && primary.toLowerCase() === countryInfo.country.toLowerCase()) {
    const countryDisplay = formatCountryName(countryInfo.country, location.countryCode || '');
    return {
      primary: '', // Hide duplicate on line 1
      country: countryDisplay, // Show country with flag on line 2
      countryCode: location.countryCode || ''
    };
  }
  
  
  // Show next broadest category on second line
  // Hierarchy: neighborhood → city → state → country
  // Skip categories that have overlapping names with the primary location
  const nextBroadestCategory = getNextBroadestCategory(location, primaryCategory, primary);
  const countryDisplay = nextBroadestCategory ? nextBroadestCategory : undefined;
  return {
    primary,
    country: countryDisplay,
    countryCode: location.countryCode || ''
  };
}

/**
 * Gets the next broadest category in the hierarchy: neighbourhood → city → state → country
 * Returns the formatted name for display on the second line
 * Skips categories that have overlapping names with the primary location
 * 
 * @param location Location data
 * @param currentCategory Current category of the primary location
 * @param primaryName Primary location name to check for duplicates
 * @returns Formatted name for the next broadest category, or undefined if none found
 */
function getNextBroadestCategory(
  location: LocationData,
  currentCategory: LocationCategory,
  primaryName: string
): string | undefined {
  /**
   * Tries all fields within a category, skipping overlapping names
   * Only moves to next category if ALL fields in current category overlap or are invalid
   * This ensures we maintain precision when possible (e.g., try all city fields before falling back to state)
   */
  const tryFields = (fields: (keyof LocationData)[], skipIfOverlaps: boolean = true): string | null => {
    // Check each field in priority order
    for (const field of fields) {
      const value = location[field] as string | undefined;
      if (value && isValidLocationName(value)) {
        // Skip if this value overlaps with the primary name, continue to next field in same category
        if (skipIfOverlaps && hasOverlappingNames(primaryName, value)) {
          continue; // Try next field in same category
        }
        // Found a non-overlapping value in this category
        return value;
      }
    }
    // All fields in this category either overlap or are invalid - move to next category
    return null;
  };

  // Field definitions (same as above, for consistency)
  const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet'];
  const stateFields: (keyof LocationData)[] = ['state', 'province', 'region', 'county'];
  const countryInfo = getCountry(location);

  // Hierarchy: neighbourhood → city → state → country
  switch (currentCategory) {
    case 'neighbourhood':
      // Next broadest: city
      const cityName = tryFields(cityFields);
      if (cityName) return cityName;
      // Fallback to state if no city (or city overlaps)
      const stateName = tryFields(stateFields);
      if (stateName) return stateName;
      // Fallback to country if no state (or state overlaps)
      const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
      // Check if country overlaps (e.g., "Singapore, Singapore")
      if (countryDisplay && !hasOverlappingNames(primaryName, countryDisplay)) {
        return countryDisplay;
      }
      return undefined;
    
    case 'city':
      // Next broadest: state category (includes state, province/prefecture, region, county)
      const state = tryFields(stateFields);
      if (state) return state;
      // Fallback to country if no state category fields (or state overlaps)
      const countryDisplay2 = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
      if (countryDisplay2 && !hasOverlappingNames(primaryName, countryDisplay2)) {
        return countryDisplay2;
      }
      return undefined;
    
    case 'county':
      // County is now part of state category, so next broadest is country
      const countryDisplay3 = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
      if (countryDisplay3 && !hasOverlappingNames(primaryName, countryDisplay3)) {
        return countryDisplay3;
      }
      return undefined;
    
    case 'state':
      // Next broadest: country
      const countryDisplay4 = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
      if (countryDisplay4 && !hasOverlappingNames(primaryName, countryDisplay4)) {
        return countryDisplay4;
      }
      return undefined;
    
    case 'country':
      // No broader category, return undefined
      return undefined;
    
    default:
      // Unknown category, fallback to country
      const countryDisplay5 = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
      if (countryDisplay5 && !hasOverlappingNames(primaryName, countryDisplay5)) {
        return countryDisplay5;
      }
      return undefined;
  }
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
