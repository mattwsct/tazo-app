import { MAX_CHARACTER_LIMIT } from './name-utils';
import type { LocationData } from '../location-utils';

/**
 * Intelligently formats country names for display
 */
export function formatCountryName(countryName: string, countryCode = ''): string {
  if (!countryName && !countryCode) return '';

  const commonShortenings: Record<string, string> = {
    'united kingdom of great britain and northern ireland': 'United Kingdom',
    'united states of america': 'United States',
    'democratic republic of the congo': 'DR Congo',
    'saint vincent and the grenadines': 'St. Vincent',
    'central african republic': 'Central Africa',
    'united states': 'United States',
    'united kingdom': 'United Kingdom',
    'bosnia and herzegovina': 'Bosnia',
    'russian federation': 'Russia',
    'republic of the congo': 'Congo',
    'czech republic': 'Czechia',
    'dominican republic': 'Dominican Rep.',
    'united arab emirates': 'UAE',
    'trinidad and tobago': 'Trinidad',
    'sao tome and principe': 'São Tomé',
    'antigua and barbuda': 'Antigua',
    'saint kitts and nevis': 'St. Kitts',
    'papua new guinea': 'Papua New Guinea',
    'sri lanka': 'Sri Lanka',
    'south africa': 'South Africa',
    'new zealand': 'New Zealand',
  };

  if (countryName) {
    const lowerCountryName = countryName.toLowerCase();

    if (commonShortenings[lowerCountryName]) {
      return commonShortenings[lowerCountryName];
    }

    if (countryName.length > MAX_CHARACTER_LIMIT) {
      return countryCode ? countryCode.toUpperCase() : countryName;
    }

    return countryName;
  }

  return countryCode ? countryCode.toUpperCase() : '';
}

/**
 * Gets country for a location with character limit and smart shortening
 */
export function getCountry(location: LocationData): { country: string; wasAbbreviated: boolean } | null {
  const countryCode = (location.countryCode || '').toUpperCase();
  const countryName = location.country || '';

  if (!countryName && !countryCode) return null;

  const formatted = formatCountryName(countryName, countryCode);
  if (!formatted) return null;

  const wasAbbreviated = formatted.toLowerCase() !== countryName.toLowerCase();

  return { country: formatted, wasAbbreviated };
}
