/**
 * Format location for stream title display.
 * Returns "🇺🇸 United States" | "🇺🇸 California, United States" | "🇺🇸 San Francisco, California"
 */

import type { LocationData } from './location-utils';
import { formatCountryName } from './location-utils';
import { getCountryFlagEmoji, getCountryNameFromCode } from './chat-utils';

export type StreamTitleLocationDisplay = 'country' | 'country_state' | 'country_city';

export function formatLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  display: StreamTitleLocationDisplay
): string {
  if (!rawLocation) return '';

  const countryCode = (rawLocation.countryCode || '').toUpperCase();
  const country = rawLocation.country || getCountryNameFromCode(countryCode);
  const state = rawLocation.state || rawLocation.province || rawLocation.region;
  const city =
    rawLocation.city ||
    rawLocation.municipality ||
    rawLocation.town ||
    rawLocation.county ||
    rawLocation.village ||
    rawLocation.hamlet;

  const flag = getCountryFlagEmoji(countryCode);
  const countryName = formatCountryName(country, countryCode);

  if (!flag && !countryName) return '';

  switch (display) {
    case 'country':
      return flag ? `${flag} ${countryName}` : countryName;
    case 'country_state':
      if (state && state !== countryName) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    case 'country_city':
      if (city) {
        const suffix = state && state !== countryName ? `${state}, ${countryName}` : countryName;
        return flag ? `${flag} ${city}, ${suffix}` : `${city}, ${suffix}`;
      }
      if (state && state !== countryName) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    default:
      return flag ? `${flag} ${countryName}` : countryName;
  }
}
