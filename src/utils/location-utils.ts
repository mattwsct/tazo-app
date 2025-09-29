// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

const MAX_CHARACTER_LIMIT = 16; // Single limit for both primary and country lines

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
}

export interface LocationDisplay {
  primary: string;  // Most precise available location
  country?: string; // Country name/code (no dedupe vs primary)
}

// === 🎯 LOCATION PRECISION LEVELS ===

type LocationPrecision = 'precise' | 'broad' | 'region';


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
 * Gets the best location name for a given precision level with 14-character limit
 * 
 * Fallback chain: try each field in order until we find one that exists and fits within limit.
 */
function getLocationByPrecision(location: LocationData, precision: LocationPrecision): string {
  const getField = (fields: (string | undefined)[]): string => {
    return fields.find(field => field && field.length <= MAX_CHARACTER_LIMIT) || '';
  };

  // Single source of truth for ordering (most precise → least)
  const preciseOrderKeys: (keyof LocationData)[] = [
    'hamlet',
    'village',
    'neighbourhood',
    'suburb',
    'ward',
    'borough',
    'town',
    'city',
    'municipality',
    'district',
    'county'
  ];

  let keysToUse: (keyof LocationData)[];
  if (precision === 'precise') {
    keysToUse = preciseOrderKeys;
  } else if (precision === 'broad') {
    keysToUse = [...preciseOrderKeys].reverse();
  } else { // region
    keysToUse = [
      'state',
      'province', 
      'region',
      'city',
      'county',
      'municipality',
      'district',
      'town'
    ];
  }

  const valuesInOrder = keysToUse.map((key) => location[key] as string | undefined);

  return getField(valuesInOrder);
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
  displayMode: 'precise' | 'broad' | 'region' | 'custom' | 'hidden' = 'precise'
): LocationDisplay {
  if (!location || displayMode === 'hidden' || displayMode === 'custom') return { primary: '', country: undefined };
  
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
