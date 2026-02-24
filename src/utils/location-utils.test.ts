import { describe, expect, it } from 'vitest';
import {
  formatLocation,
  stripTrailingNumbers,
  formatCountryName,
  getLocationLevels,
} from '@/utils/location-utils';
import type { LocationData } from '@/utils/location-utils';

describe('stripTrailingNumbers', () => {
  it('strips trailing numbers from location names', () => {
    expect(stripTrailingNumbers('Honcho 6')).toBe('Honcho');
    expect(stripTrailingNumbers('Honmachi 3')).toBe('Honmachi');
  });
  it('leaves names without trailing numbers unchanged', () => {
    expect(stripTrailingNumbers('Tokyo')).toBe('Tokyo');
    expect(stripTrailingNumbers('4th Avenue')).toBe('4th Avenue');
  });
  it('handles empty or invalid input', () => {
    expect(stripTrailingNumbers('')).toBe('');
    expect(stripTrailingNumbers(undefined as unknown as string)).toBe(undefined);
  });
});

describe('formatLocation', () => {
  it('returns empty for hidden mode', () => {
    const loc: LocationData = { city: 'Tokyo', country: 'Japan', countryCode: 'jp' };
    expect(formatLocation(loc, 'hidden')).toEqual({ primary: '', secondary: undefined });
  });
  it('shows city with country for city mode', () => {
    const loc: LocationData = { city: 'Tokyo', state: 'Tokyo', country: 'Japan', countryCode: 'jp' };
    const result = formatLocation(loc, 'city');
    expect(result.primary).toBe('Tokyo');
    expect(result.secondary).toBeTruthy();
  });
  it('avoids duplicate names (Tokyo, Tokyo)', () => {
    const loc: LocationData = { city: 'Tokyo', state: 'Tokyo', country: 'Japan', countryCode: 'jp' };
    const result = formatLocation(loc, 'city');
    expect(result.primary).toBe('Tokyo');
  });
  it('returns country only for country mode', () => {
    const loc: LocationData = { country: 'Japan', countryCode: 'jp' };
    const result = formatLocation(loc, 'country');
    expect(result.primary).toBe('');
    expect(result.secondary).toContain('Japan');
  });
  it('returns empty for null location', () => {
    expect(formatLocation(null, 'city')).toEqual({ primary: '', secondary: undefined });
  });
});

describe('getLocationLevels', () => {
  const bali: LocationData = { city: 'Kuta', state: 'Bali', country: 'Indonesia', countryCode: 'ID' };

  it('returns all levels for city mode (default)', () => {
    const levels = getLocationLevels(bali);
    expect(levels).toContain('Kuta');
    expect(levels.some(l => l.includes('Bali'))).toBe(true);
    expect(levels.some(l => l.includes('Indonesia'))).toBe(true);
  });

  it('returns state + country for state mode (no city)', () => {
    const levels = getLocationLevels(bali, 'state');
    expect(levels.every(l => !l.includes('Kuta'))).toBe(true);
    expect(levels.some(l => l.includes('Bali'))).toBe(true);
    expect(levels.some(l => l.includes('Indonesia'))).toBe(true);
  });

  it('returns only country for country mode', () => {
    const levels = getLocationLevels(bali, 'country');
    expect(levels.every(l => !l.includes('Kuta'))).toBe(true);
    expect(levels.every(l => !l.includes('Bali'))).toBe(true);
    expect(levels.some(l => l.includes('Indonesia'))).toBe(true);
  });

  it('returns empty for null location', () => {
    expect(getLocationLevels(null)).toEqual([]);
  });

  it('deduplicates overlapping names', () => {
    const sg: LocationData = { city: 'Singapore', state: 'Singapore', country: 'Singapore', countryCode: 'SG' };
    const levels = getLocationLevels(sg, 'city');
    expect(levels.length).toBe(1);
  });
});

describe('formatCountryName', () => {
  it('shortens long country names', () => {
    expect(formatCountryName('United States of America', 'US')).toBe('United States');
    expect(formatCountryName('United Kingdom of Great Britain and Northern Ireland', 'GB')).toBe('United Kingdom');
  });
  it('leaves short names unchanged', () => {
    expect(formatCountryName('Japan', 'jp')).toBe('Japan');
  });
  it('returns country code when no name', () => {
    expect(formatCountryName('', 'US')).toBe('US');
  });
});
