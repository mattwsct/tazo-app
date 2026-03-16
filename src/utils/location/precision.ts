import { isGenericNeighbourhood, cleanForDisplay } from './name-utils';
import { getCountry, formatCountryName } from './country-utils';
import { hasOverlappingNames } from '../string-utils';
import type { LocationData } from '../location-utils';

export type LocationPrecision = 'suburb' | 'city' | 'state';
export type LocationCategory = 'suburb' | 'city' | 'county' | 'state' | 'country';

export const suburbFields: (keyof LocationData)[] = ['suburb', 'neighbourhood', 'quarter', 'ward', 'borough', 'district'];
export const cityFields: (keyof LocationData)[] = ['city', 'municipality', 'town', 'village', 'hamlet', 'county'];
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

  const skipGenericSuburb = (name: string) => !isGenericNeighbourhood(name);

  const fallbackChains: Record<LocationPrecision, (keyof LocationData)[][]> = {
    suburb: [suburbFields, cityFields, stateFields],
    city: [cityFields, stateFields],
    state: [stateFields],
  };

  const chain = fallbackChains[precision] || [];

  for (let i = 0; i < chain.length; i++) {
    const filter = chain[i] === suburbFields ? (_n: string, _f: keyof LocationData) => skipGenericSuburb(_n) : undefined;
    const name = tryFields(chain[i], filter);
    if (name) {
      const category: LocationCategory =
        chain[i] === suburbFields ? 'suburb' :
        chain[i] === cityFields ? 'city' : 'state';
      return { name, category };
    }
  }

  return { name: '', category: 'country' };
}

/**
 * Gets the next broadest category in the hierarchy: suburb → city → state → country
 */
export function getNextBroadestCategory(
  location: LocationData,
  currentCategory: LocationCategory,
  primaryName: string
): string | undefined {
  const tryFields = (fields: (keyof LocationData)[]): string | null => {
    for (const field of fields) {
      const name = cleanForDisplay(location[field] as string | undefined);
      if (name && !hasOverlappingNames(primaryName, name)) return name;
    }
    return null;
  };

  const countryInfo = getCountry(location);
  const countryDisplay = countryInfo ? formatCountryName(countryInfo.country, location.countryCode || '') : undefined;
  const tryCountry = () => countryDisplay && !hasOverlappingNames(primaryName, countryDisplay) ? countryDisplay : undefined;

  // Each level's chain defines what to try next before falling back to country
  const chains: Record<LocationCategory, (keyof LocationData)[][]> = {
    suburb: [cityFields, stateFields],
    city: [stateFields],
    county: [stateFields],
    state: [],
    country: [],
  };

  const chain = chains[currentCategory] ?? [];
  for (const fields of chain) {
    const found = tryFields(fields);
    if (found) return found;
  }
  return tryCountry();
}
