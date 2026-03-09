import { isGenericNeighbourhood, cleanForDisplay } from './name-utils';
import { getCountry, formatCountryName } from './country-utils';
import { hasOverlappingNames } from '../string-utils';
import type { LocationData } from '../location-utils';

export type LocationPrecision = 'city' | 'state';
export type LocationCategory = 'city' | 'county' | 'state' | 'country';

export const cityFields: (keyof LocationData)[] = ['suburb', 'neighbourhood', 'city', 'municipality', 'town', 'county', 'village', 'hamlet'];
export const stateFields: (keyof LocationData)[] = ['state', 'province', 'region'];

/**
 * Gets the best location name for a given precision level with automatic fallback
 */
export function getLocationByPrecision(
  location: LocationData,
  precision: LocationPrecision
): { name: string; category: LocationCategory } {
  const tryFields = (
    fields: (keyof LocationData)[],
    filter?: (name: string, field: keyof LocationData) => boolean,
  ): string | null => {
    for (const field of fields) {
      const name = cleanForDisplay(location[field] as string | undefined);
      if (name && (!filter || filter(name, field))) return name;
    }
    return null;
  };

  const suburbanFields = new Set<keyof LocationData>(['suburb', 'neighbourhood']);
  const skipGenericSuburb = (name: string, field: keyof LocationData) =>
    !suburbanFields.has(field) || !isGenericNeighbourhood(name);

  const fallbackChains: Record<LocationPrecision, (keyof LocationData)[][]> = {
    city: [cityFields, stateFields],
    state: [stateFields],
  };

  const chain = fallbackChains[precision] || [];

  for (let i = 0; i < chain.length; i++) {
    const filter = chain[i] === cityFields ? skipGenericSuburb : undefined;
    const name = tryFields(chain[i], filter);
    if (name) {
      const category: LocationCategory = chain[i] === cityFields ? 'city' : 'state';
      return { name, category };
    }
  }

  return { name: '', category: 'country' };
}

/**
 * Gets the next broadest category in the hierarchy: neighbourhood → city → state → country
 */
export function getNextBroadestCategory(
  location: LocationData,
  currentCategory: LocationCategory,
  primaryName: string
): string | undefined {
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

  const countryInfo = getCountry(location);
  const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
  const tryCountry = () => countryDisplay && !hasOverlappingNames(primaryName, countryDisplay) ? countryDisplay : undefined;

  const chains: Record<LocationCategory, (keyof LocationData)[][]> = {
    city: [],
    county: [],
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
