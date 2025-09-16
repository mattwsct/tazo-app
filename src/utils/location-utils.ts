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
  neighbourhood?: string; // British spelling from LocationIQ
  province?: string;
  region?: string;
  county?: string;
  house_number?: string;
  road?: string;
  postcode?: string;
}

export interface LocationDisplay {
  primary: string;  // Most precise available location
  context?: string; // Administrative context (only when not redundant)
}

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'area' | 'district' | 'city' | 'province' | 'country';


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
  // Simplified: Each precision level has 2-3 primary fields, then falls back to broader levels
  const getField = (fields: (string | undefined)[]): string => {
    return fields.find(field => field && field.length <= 30) || '';
  };

  switch (precision) {
    case 'area':
      return getField([
        location.road,           // "Jalan Melasti"
        location.neighbourhood,  // "Legian"
        location.suburb,         // "Kuta"
        location.town,           // "Kuta"
        location.city,           // "Kuta" (fallback)
        location.state,          // "Bali" (fallback)
        location.country         // "Indonesia" (fallback)
      ]);
    
    case 'district':
      return getField([
        location.county,         // "Badung"
        location.municipality,   // "Badung"
        location.suburb,         // "Kuta"
        location.town,           // "Kuta" (fallback)
        location.city,           // "Kuta" (fallback)
        location.state,          // "Bali" (fallback)
        location.country         // "Indonesia" (fallback)
      ]);
    
    case 'city':
      return getField([
        location.town,           // "Kuta" (preferred)
        location.city,           // "Kuta" (fallback)
        location.municipality,   // "Badung" (fallback)
        location.suburb,         // "Kuta" (fallback)
        location.state,          // "Bali" (fallback)
        location.country         // "Indonesia" (fallback)
      ]);
    
    case 'province':
      return getField([
        location.state,          // "Bali" (preferred)
        location.province,       // "Bali" (alternative)
        location.region,         // "Lesser Sunda Islands" (fallback)
        location.country         // "Indonesia" (fallback)
      ]);
    
    case 'country':
      return getField([
        location.country,        // "Indonesia"
        location.countryCode     // "ID" (fallback)
      ]);
    
    default:
      return '';
  }
}

/**
 * Gets context for a location by finding the first non-redundant level
 * 
 * Simplified logic: for neighborhood/suburb modes, only show city, state, or country.
 * For city/state modes, only show state or country.
 */
function getContext(location: LocationData, primaryName: string, currentPrecision: LocationPrecision): string | null {
  // Simplified context: only show broader levels that are different from primary
  const province = location.state || location.province || location.region;
  
  // For area/district/city: show province then country
  if (['area', 'district', 'city'].includes(currentPrecision)) {
    if (province && !areRedundantNames(primaryName, province)) {
      return province;
    }
    if (location.country && !areRedundantNames(primaryName, location.country)) {
      return location.country;
    }
  }
  
  // For province: only show country
  if (currentPrecision === 'province') {
    if (location.country && !areRedundantNames(primaryName, location.country)) {
      return location.country;
    }
  }
  
  return null;
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
 * Simplified context logic: only shows broader administrative levels (city, state, country)
 * 
 * @example
 * // Neighborhood mode: Shows most specific location with city/state/country context
 * formatLocation({ neighbourhood: "Shinjuku 4", suburb: 'Shibuya', city: 'Tokyo', state: 'Tokyo Prefecture' }, 'neighborhood')
 * // Returns: { primary: "Shinjuku 4", context: 'Tokyo' } (skips suburb, goes to city)
 * 
 * @example
 * // Suburb mode: Shows suburb with city/state/country context
 * formatLocation({ suburb: 'Manhattan', city: 'New York City', state: 'New York' }, 'suburb')
 * // Returns: { primary: 'Manhattan', context: 'New York City' }
 * 
 * @example
 * // City mode: Shows city with state/country context
 * formatLocation({ city: 'Tokyo', state: 'Tokyo Prefecture' }, 'city')
 * // Returns: { primary: 'Tokyo', context: undefined } (duplicate detected)
 * 
 * @example
 * // State mode: Shows state with country context
 * formatLocation({ state: 'California', country: 'United States' }, 'state')
 * // Returns: { primary: 'California', context: 'United States' }
 */
export function formatLocation(
  location: LocationData | null, 
  displayMode: 'area' | 'district' | 'city' | 'province' | 'country' | 'hidden' | 'custom' = 'area'
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
