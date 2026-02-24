// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

import { hasOverlappingNames } from './string-utils';

const MAX_CHARACTER_LIMIT = 16; // Single limit for both primary and secondary lines

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
  primary: string;  // Most precise available location (Line 1)
  secondary?: string; // Secondary line - next broadest category (Line 2). Can be city, state, or country name depending on primary category
  countryCode?: string; // ISO country code for flag display (always the actual country, regardless of what's in 'secondary' field)
}

const cleanName = (s: string | undefined): string | undefined =>
  s ? stripTrailingNumbers(s) : s;

/**
 * Extracts display-relevant location fields for persistent storage.
 * Includes neighbourhood, city, state, country and fallbacks so admin display mode
 * (neighbourhood/city/state/country) can use any available precision.
 * Excludes sensitive fields (house_number, road, postcode, coordinates).
 * Applies stripTrailingNumbers so overlay and persistence use the same cleaned names.
 */
export function getLocationForPersistence(location: LocationData | null): LocationData | null {
  if (!location) return null;
  return {
    country: cleanName(location.country),
    countryCode: location.countryCode,
    city: cleanName(location.city),
    state: cleanName(location.state),
    timezone: location.timezone,
    town: cleanName(location.town),
    municipality: cleanName(location.municipality),
    suburb: cleanName(location.suburb),
    neighbourhood: cleanName(location.neighbourhood),
    quarter: cleanName(location.quarter),
    province: cleanName(location.province),
    region: cleanName(location.region),
    county: cleanName(location.county),
    village: cleanName(location.village),
    hamlet: cleanName(location.hamlet),
    district: cleanName(location.district),
    ward: cleanName(location.ward),
    borough: cleanName(location.borough),
  };
}

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'city' | 'state';

// Category types to track which location category was used
type LocationCategory = 'city' | 'county' | 'state' | 'country';


// === 🔍 SIMPLE FILTERING ===

/**
 * Checks if a string contains only Latin script (including accented and extended characters)
 * Allows: Basic Latin, Latin-1 Supplement (é, ñ, ü), Latin Extended-A (Đ, ğ, Polish ąęć, etc.),
 * Latin Extended-B (Romanian ș ț, ẞ, etc.), Latin Extended Additional (Vietnamese ủ, ứ, ơ, etc.)
 * Rejects: Non-Latin alphabets (Japanese, Chinese, Arabic, Cyrillic, etc.)
 */
function isLatinScript(name: string): boolean {
  if (!name) return false;

  const trimmed = name.trim();

  // Check for common non-Latin script ranges:
  // - Japanese: Hiragana (3040-309F), Katakana (30A0-30FF), Kanji (4E00-9FAF)
  // - Chinese: CJK Unified Ideographs (4E00-9FFF)
  // - Arabic: Arabic (0600-06FF)
  // - Cyrillic: Cyrillic (0400-04FF)
  // - Korean: Hangul (AC00-D7AF)
  // - Thai: Thai (0E00-0E7F)
  // - Hebrew: Hebrew (0590-05FF)
  const nonLatinPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF\uAC00-\uD7AF\u0E00-\u0E7F\u0590-\u05FF]/;

  if (nonLatinPattern.test(trimmed)) {
    return false;
  }

  // Allow Latin blocks used in place names:
  // - 0020-007F: Basic Latin (printable ASCII)
  // - 00A0-00FF: Latin-1 Supplement (à, é, ñ, ü, etc.)
  // - 0100-017F: Latin Extended-A (Đ, ğ, ş, Polish ąęćłń, Czech ř, Hungarian őű, etc.)
  // - 0180-024F: Latin Extended-B (Romanian ș ț, ẞ, African orthographies, etc.)
  // - 1E00-1EFF: Latin Extended Additional (Vietnamese ủ ứ ơ, etc.)
  const latinPattern = /^[\u0020-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\s\-'.,0-9]+$/;

  return latinPattern.test(trimmed);
}

/**
 * Strips trailing numbers from location names (e.g. "Honcho 6" -> "Honcho", "Honmachi 3" -> "Honmachi").
 * Single source of truth for making location names clean and readable.
 */
export function stripTrailingNumbers(name: string): string {
  if (!name || typeof name !== 'string') return name;
  return name.replace(/\s+\d+$/, '').trim() || name;
}

/**
 * Validates location names for display (length, script, not just a number).
 */
function isValidLocationName(name: string): boolean {
  if (!name || name.length > MAX_CHARACTER_LIMIT) return false;
  if (!isLatinScript(name)) return false;
  if (/^\d+$/.test(name.trim())) return false;
  return true;
}

/**
 * Cleans a raw location name for display: strip numbers → validate → normalize.
 * Use this whenever we pick a name from location data for overlay/chat.
 */
function cleanForDisplay(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = stripTrailingNumbers(value);
  if (!cleaned || !isValidLocationName(cleaned)) return null;
  return normalizeToEnglish(cleaned);
}


// === 🌐 LOCATION NAME NORMALIZATION ===

/**
 * Normalizes location names for display (no hardcoded mappings).
 * English is ensured via API accept-language parameter.
 */
function normalizeToEnglish(name: string): string {
  return name ? name.trim() : name;
}

// === 🗺️ LOCATION DATA EXTRACTION ===

/**
 * Gets the best location name for a given precision level with automatic fallback
 * Returns both the location name and the category it came from
 * 
 * If the requested precision level has names that are too long (>16 chars),
 * it automatically falls back to the next less specific level.
 * 
 * Fallback hierarchy:
 * - neighbourhood: neighbourhood/suburb/ward → city/town/county → state → country
 * - city: city/town/county → state → country
 * - state: state/province/prefecture/region → country
 * 
 * Both modes share the same fallback chain (city → state).
 * Neighbourhood mode adds neighbourhood fields at the beginning for more precision.
 * 
 * Global compatibility:
 * - Works worldwide as LocationIQ provides country-appropriate fields
 * - City category includes: city, municipality, town, village, hamlet, county (metropolitan areas)
 * - State category includes: state, province (prefectures), region
 * - Field names vary by country but hierarchy is generally consistent
 * - Only area-based locations are used (no street addresses/road names)
 * - Names are normalized to English when possible
 */
function getLocationByPrecision(
  location: LocationData, 
  precision: LocationPrecision
): { name: string; category: LocationCategory } {
  // Try to find a valid name at the current precision level
  // Normalize names to English when possible
  const tryFields = (fields: (keyof LocationData)[]): string | null => {
    for (const field of fields) {
      const name = cleanForDisplay(location[field] as string | undefined);
      if (name) return name;
    }
    return null;
  };

  // === CATEGORY DEFINITIONS ===
  // Each category contains specific fields from LocationIQ API, ordered by priority
  
  // CITY: Settlements and urban areas (ordered from most appropriate to least appropriate)
  // Fields: city (most appropriate) → municipality → town → county → village → hamlet (least appropriate)
  // NOTE: Suburb is NOT included - it's a neighbourhood field, not a city field
  // NOTE: County is included here as it often represents metropolitan areas (e.g., Gold Coast)
  // NOTE: County comes before village/hamlet as metropolitan areas are more city-like than small settlements
  const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'county', 'village', 'hamlet'];
  
  // STATE: Large administrative divisions (includes states, provinces, prefectures, regions)
  // Fields: state, province, region
  // Priority: state → province (prefectures) → region
  const stateFields: (keyof LocationData)[] = ['state', 'province', 'region'];
  
  // Fallback hierarchy: city → state → country
  const fallbackChains: Record<LocationPrecision, (keyof LocationData)[][]> = {
    city: [cityFields, stateFields],
    state: [stateFields],
  };
  
  const chain = fallbackChains[precision] || [];
  
  for (let i = 0; i < chain.length; i++) {
    const name = tryFields(chain[i]);
    if (name) {
      const category: LocationCategory = chain[i] === cityFields ? 'city' : 'state';
      return { name, category };
    }
  }
    
    // If nothing worked, return empty (will use country as last resort in formatLocation)
  return { name: '', category: 'country' };
}

/**
 * Gets country for a location with character limit and smart shortening
 * 
 * Rules:
 * - If name fits (≤16 chars), use it
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
  // For countries >16 chars, we provide readable shortenings that are still recognizable
  const commonShortenings: Record<string, string> = {
    // Very long names (>25 chars) - use common abbreviations
    'united kingdom of great britain and northern ireland': 'United Kingdom',
    'united states of america': 'United States',
    'democratic republic of the congo': 'DR Congo',
    'saint vincent and the grenadines': 'St. Vincent',
    'central african republic': 'Central Africa',
    
    // Long names (16-25 chars) - use readable shortenings
    'united states': 'United States',
    'united kingdom': 'United Kingdom',
    'bosnia and herzegovina': 'Bosnia',
    'russian federation': 'Russia',
    
    // Medium-long names - use common short forms
    'republic of the congo': 'Congo',
    'czech republic': 'Czechia',
    'dominican republic': 'Dominican Rep.',
    'united arab emirates': 'UAE',
    'trinidad and tobago': 'Trinidad',
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

// === 🎨 MAIN LOCATION FORMATTING ===

/**
 * Formats location data for overlay display with 16-character limits
 * 
 * Rules:
 * - Precise: Shows most specific location with country
 * - Broad: Shows broader location with country
 * - Region: Shows state/province with country
 * - Secondary line: Country name if ≤16 chars, else country code
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
  displayMode: 'city' | 'state' | 'country' | 'custom' | 'hidden' = 'city'
): LocationDisplay {
  if (!location || displayMode === 'hidden') return { primary: '', secondary: undefined };
  
  // For country mode, show only shortened country name/flag (no primary location, no state)
  if (displayMode === 'country') {
    const countryInfo = getCountry(location);
    // Use shortened country name directly, not state+country format
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', secondary: secondaryDisplay, countryCode: location.countryCode || '' };
  }
  
  // For custom mode, we still need the country name/flag, just not the primary location
  if (displayMode === 'custom') {
    const countryInfo = getCountry(location);
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', secondary: secondaryDisplay, countryCode: location.countryCode || '' };
  }
  
  // For state mode, show state on line 1 and country on line 2
  if (displayMode === 'state') {
    const primaryResult = getLocationByPrecision(location, 'state');
    let primary = primaryResult.name;
    const countryInfo = getCountry(location);
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    
    // If no state found (e.g. Vietnam has no state/province in LocationIQ), fall back to city
    if (!primary) {
      const cityResult = getLocationByPrecision(location, 'city');
      primary = cityResult.name;
      if (primary && secondaryDisplay) {
        return { primary, secondary: secondaryDisplay, countryCode: location.countryCode || '' };
      }
      if (countryInfo) {
        return { primary: '', secondary: secondaryDisplay, countryCode: location.countryCode || '' };
      }
      return { primary: '', secondary: undefined };
    }
    
    // Show state on line 1, country ONLY on line 2 (exclude state from second line)
    // When state mode is selected, second line should only show country, not state or other broader options
    // Check for duplicate names (e.g., if state name overlaps with country name like "Singapore" state vs "Singapore" country)
    // If state and country names overlap, hide the duplicate country
    if (secondaryDisplay && hasOverlappingNames(primary, secondaryDisplay)) {
      return {
        primary: primary,
        secondary: undefined, // Hide duplicate country on line 2
        countryCode: location.countryCode || ''
      };
    }
    return {
      primary: primary,
      secondary: secondaryDisplay,
      countryCode: location.countryCode || ''
    };
  }
  
  const primaryResult = getLocationByPrecision(location, displayMode);
  const primary = primaryResult.name;
  const primaryCategory = primaryResult.category;
  const countryInfo = getCountry(location);
  
  // If no primary location found, still show next broadest category on line 2 if available
  if (!primary) {
    const requestedCategory = displayMode === 'city' ? 'city' : 
                              displayMode === 'state' ? 'state' : 'country';
    const nextBroadestCategory = getNextBroadestCategory(location, requestedCategory, '');
    if (nextBroadestCategory) {
      return { 
        primary: '', // Line 1 stays blank
        secondary: nextBroadestCategory, // Line 2 shows next broadest category
        countryCode: location.countryCode || ''
      };
    }
    // No location data at all
    return { primary: '', secondary: undefined };
  }
  
  // Check for duplicate names (e.g., "Singapore, Singapore" or "Monaco, Monaco")
  // If primary matches or overlaps with country, hide primary and show only country with flag on line 2
  // Uses overlap detection to catch exact matches and cases like "Singapore" vs "Republic of Singapore"
  if (countryInfo) {
    const secondaryDisplay = formatCountryName(countryInfo.country, location.countryCode || '');
    if (secondaryDisplay && hasOverlappingNames(primary, secondaryDisplay)) {
      return {
        primary: '', // Hide duplicate on line 1
        secondary: secondaryDisplay, // Show country with flag on line 2
        countryCode: location.countryCode || ''
      };
    }
  }
  
  
  // Show next broadest category on second line
  // Hierarchy: neighborhood → city → state → country
  // Skip categories that have overlapping names with the primary location
  const nextBroadestCategory = getNextBroadestCategory(location, primaryCategory, primary);
  const secondaryDisplay = nextBroadestCategory ? nextBroadestCategory : undefined;
  return {
    primary,
    secondary: secondaryDisplay,
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
    for (const field of fields) {
      const name = cleanForDisplay(location[field] as string | undefined);
      if (name) {
        if (skipIfOverlaps && hasOverlappingNames(primaryName, name)) continue;
        return name;
      }
    }
    return null;
  };

  const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'county', 'village', 'hamlet'];
  const stateFields: (keyof LocationData)[] = ['state', 'province', 'region'];
  const countryInfo = getCountry(location);
  const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
  const tryCountry = () => countryDisplay && !hasOverlappingNames(primaryName, countryDisplay) ? countryDisplay : undefined;

  // Fallback chain per category: city/county→[state,country], state→[country]
  const chains: Record<LocationCategory, (keyof LocationData)[][]> = {
    city: [stateFields],
    county: [stateFields],
    state: [],
    country: [],
  };
  const chain = chains[currentCategory] ?? [stateFields];
  for (const fields of chain) {
    const found = tryFields(fields);
    if (found) return found;
  }
  return tryCountry();
}


/**
 * Returns deduplicated location names at city/state/country granularity for rotation display.
 * Flag is handled separately (always visible), so country name is included as text.
 * When displayMode is provided, only levels at or broader than the selected mode are returned:
 *   'city'    -> city, state, country (full rotation)
 *   'state'   -> state, country
 *   'country' -> country only
 */
export function getLocationLevels(
  location: LocationData | null,
  displayMode: 'city' | 'state' | 'country' = 'city'
): string[] {
  if (!location) return [];

  const tryFields = (fields: (keyof LocationData)[]): string | null => {
    for (const f of fields) {
      const name = cleanForDisplay(location[f] as string | undefined);
      if (name) return name;
    }
    return null;
  };

  const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'county', 'village', 'hamlet'];
  const stateFields: (keyof LocationData)[] = ['state', 'province', 'region'];

  const city = displayMode === 'city' ? tryFields(cityFields) : null;
  const state = displayMode !== 'country' ? tryFields(stateFields) : null;
  const countryInfo = getCountry(location);
  const country = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : null;

  const levels: string[] = [];
  for (const name of [city, state, country]) {
    if (!name) continue;
    const isDuplicate = levels.some(existing => hasOverlappingNames(existing, name));
    if (!isDuplicate) levels.push(name);
  }
  return levels;
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

