// === 🌍 LOCATION & GEOGRAPHIC UTILITIES ===

import { hasOverlappingNames } from './string-utils';
import {
  stripTrailingNumbers,
  stripAdminSuffix,
  isGenericNeighbourhood,
  cleanForDisplay,
} from './location/name-utils';
import { formatCountryName, getCountry } from './location/country-utils';
import { getLocationByPrecision, getNextBroadestCategory } from './location/precision';

// Re-export public API from sub-modules
export { stripTrailingNumbers, stripAdminSuffix } from './location/name-utils';
export { formatCountryName } from './location/country-utils';

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
  secondary?: string; // Secondary line - next broadest category (Line 2).
  countryCode?: string; // ISO country code for flag display
}

const cleanName = (s: string | undefined): string | undefined =>
  s ? stripTrailingNumbers(s) : s;

/**
 * Extracts display-relevant location fields for persistent storage.
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

/**
 * Gets the best city name by selecting the first available city field.
 */
export function getBestCityName(location: LocationData): string {
  const clean = (raw: string | undefined) => {
    if (!raw) return null;
    return stripAdminSuffix(stripTrailingNumbers(raw)).trim() || null;
  };

  for (const raw of [location.suburb, location.neighbourhood]) {
    const name = clean(raw);
    if (name && !isGenericNeighbourhood(name)) return name;
  }

  for (const raw of [location.city, location.municipality, location.town, location.village, location.hamlet]) {
    const name = clean(raw);
    if (name) return name;
  }

  return '';
}

/**
 * Formats location data for overlay display with 16-character limits
 */
export function formatLocation(
  location: LocationData | null,
  displayMode: 'suburb' | 'city' | 'state' | 'country' | 'custom' | 'hidden' = 'city'
): LocationDisplay {
  if (!location || displayMode === 'hidden') return { primary: '', secondary: undefined };

  if (displayMode === 'country') {
    const countryInfo = getCountry(location);
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', secondary: secondaryDisplay, countryCode: location.countryCode || '' };
  }

  if (displayMode === 'custom') {
    const countryInfo = getCountry(location);
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
    return { primary: '', secondary: secondaryDisplay, countryCode: location.countryCode || '' };
  }

  if (displayMode === 'state') {
    const primaryResult = getLocationByPrecision(location, 'state');
    let primary = primaryResult.name;
    const countryInfo = getCountry(location);
    const secondaryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;

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

    if (secondaryDisplay && hasOverlappingNames(primary, secondaryDisplay)) {
      return {
        primary: primary,
        secondary: undefined,
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

  if (!primary) {
    const requestedCategory = displayMode === 'city' ? 'city' :
                              displayMode === 'state' ? 'state' : 'country';
    const nextBroadestCategory = getNextBroadestCategory(location, requestedCategory, '');
    if (nextBroadestCategory) {
      return {
        primary: '',
        secondary: nextBroadestCategory,
        countryCode: location.countryCode || ''
      };
    }
    return { primary: '', secondary: undefined };
  }

  if (countryInfo) {
    const secondaryDisplay = formatCountryName(countryInfo.country, location.countryCode || '');
    if (secondaryDisplay && hasOverlappingNames(primary, secondaryDisplay)) {
      return {
        primary: '',
        secondary: secondaryDisplay,
        countryCode: location.countryCode || ''
      };
    }
  }

  const nextBroadestCategory = getNextBroadestCategory(location, primaryCategory, primary);
  const secondaryDisplay = nextBroadestCategory ? nextBroadestCategory : undefined;
  return {
    primary,
    secondary: secondaryDisplay,
    countryCode: location.countryCode || ''
  };
}

/**
 * Returns deduplicated location names at suburb/city/state/country granularity for rotation display.
 */
export function getLocationLevels(
  location: LocationData | null,
  displayMode: 'suburb' | 'city' | 'state' | 'country' = 'city'
): string[] {
  if (!location) return [];

  const tryFields = (fields: (keyof LocationData)[]): string | null => {
    for (const f of fields) {
      const name = cleanForDisplay(location[f] as string | undefined);
      if (name) return name;
    }
    return null;
  };

  const suburbFieldsList: (keyof LocationData)[] = ['suburb', 'neighbourhood', 'quarter', 'ward', 'borough', 'district'];
  const cityFieldsList: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet', 'county'];
  const stateFieldsList: (keyof LocationData)[] = ['state', 'province', 'region'];

  const suburb = displayMode === 'suburb' ? tryFields(suburbFieldsList) : null;
  const city = (displayMode === 'suburb' || displayMode === 'city') ? tryFields(cityFieldsList) : null;
  const state = displayMode === 'state' ? tryFields(stateFieldsList)
    : ((displayMode === 'suburb' || displayMode === 'city') && !city) ? tryFields(stateFieldsList)
    : null;
  const countryInfo = getCountry(location);
  const country = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : null;

  const levels: string[] = [];
  for (const name of [suburb, city, state, country]) {
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
