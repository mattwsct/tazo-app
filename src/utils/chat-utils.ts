// === 💬 CHAT COMMAND UTILITIES ===

import type { LocationData } from './location-utils';
import { formatLocation, getBestCityName } from './location-utils';

/**
 * Formats location data for chat command text responses
 */
export function formatLocationForChat(
  location: LocationData | null,
  displayMode: 'city' | 'state' | 'country' = 'city'
): string {
  if (!location) return 'Location unavailable';
  
  const formatted = formatLocation(location, displayMode);
  
  if (!formatted.primary && !formatted.secondary) {
    return 'Location unavailable';
  }
  
  if (formatted.primary && formatted.secondary) {
    return `${formatted.primary}, ${formatted.secondary}`;
  }
  
  return formatted.primary || formatted.secondary || 'Location unavailable';
}

/**
 * Converts ISO country code to flag emoji
 */
function getCountryFlagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return '';
  
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  
  return String.fromCodePoint(...codePoints);
}

/**
 * Converts ISO country code to country name (fallback when country name not available)
 */
function getCountryNameFromCode(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return '';
  
  const code = countryCode.toUpperCase();
  const countryNames: Record<string, string> = {
    'US': 'United States',
    'JP': 'Japan',
    'GB': 'United Kingdom',
    'FR': 'France',
    'DE': 'Germany',
    'IT': 'Italy',
    'ES': 'Spain',
    'CA': 'Canada',
    'AU': 'Australia',
    'NZ': 'New Zealand',
    'BR': 'Brazil',
    'MX': 'Mexico',
    'IN': 'India',
    'CN': 'China',
    'KR': 'South Korea',
    'TH': 'Thailand',
    'VN': 'Vietnam',
    'ID': 'Indonesia',
    'MY': 'Malaysia',
    'PH': 'Philippines',
    'SG': 'Singapore',
    'TW': 'Taiwan',
    'HK': 'Hong Kong',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'PL': 'Poland',
    'CZ': 'Czech Republic',
    'PT': 'Portugal',
    'GR': 'Greece',
    'IE': 'Ireland',
    'RU': 'Russia',
    'TR': 'Turkey',
    'SA': 'Saudi Arabia',
    'AE': 'United Arab Emirates',
    'EG': 'Egypt',
    'ZA': 'South Africa',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'IS': 'Iceland',
    'LU': 'Luxembourg',
    'MT': 'Malta',
    'CY': 'Cyprus',
    'HR': 'Croatia',
    'SI': 'Slovenia',
    'SK': 'Slovakia',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'EE': 'Estonia',
    'LV': 'Latvia',
    'LT': 'Lithuania',
    'UA': 'Ukraine',
    'BY': 'Belarus',
    'RS': 'Serbia',
    'BA': 'Bosnia and Herzegovina',
    'MK': 'North Macedonia',
    'AL': 'Albania',
    'ME': 'Montenegro',
    'XK': 'Kosovo',
  };
  
  return countryNames[code] || code;
}

/**
 * Gets city-level location name for chat commands (city, country with flag)
 * Always uses country name (not code) when available
 */
export function getCityLocationForChat(location: LocationData | null): string {
  if (!location) return '';
  
  const city = getBestCityName(location);
  const countryCode = location.countryCode;
  // Prefer country name from location data, fallback to name from code if needed
  const countryName = location.country || (countryCode ? getCountryNameFromCode(countryCode) : '');
  
  const flag = countryCode ? getCountryFlagEmoji(countryCode) : '';
  
  if (city && countryName) {
    return flag ? `${city}, ${countryName} ${flag}` : `${city}, ${countryName}`;
  }
  
  if (city && countryCode) {
    // Even if we don't have country name, try to get it from code
    const fallbackCountryName = getCountryNameFromCode(countryCode);
    return flag ? `${city}, ${fallbackCountryName} ${flag}` : `${city}, ${fallbackCountryName}`;
  }
  
  return city || countryName || '';
}

/**
 * Cleans query string for social media usernames
 */
export function cleanQuery(query: string): string {
  if (!query) return '';
  const first = query.trim().split(/\s+/)[0];
  return first.startsWith('@') ? first.slice(1) : first;
}

/**
 * Picks one random item from array
 */
export function pickOne<T>(arr: T[]): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Picks N random items from array
 */
export function pickN<T>(arr: T[], n: number): T[] {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= n) return [...arr];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * Rounds coordinate to 3 decimal places
 */
export function roundCoordinate(coord: number | null | undefined): number | null {
  if (coord == null || coord === undefined) return null;
  return Math.round(coord * 1000) / 1000;
}

/**
 * Gets display label for location-based commands
 */
export function getDisplayLabel(hasQuery: boolean, label: string): string {
  const cleanLabel = label ? label.replace(/(: |→ )$/, '') : '';
  return cleanLabel ? `${cleanLabel} → ` : '';
}
