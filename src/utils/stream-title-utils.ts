/**
 * Format location for stream title display.
 * One setting (locationDisplay) drives overlay, chat, stream title, and minimap.
 * - hidden: no location in stream title, minimap hidden
 * - custom: custom text on overlay AND stream title
 * - city/state/country: GPS-based precision
 */

import type { LocationData } from './location-utils';
import { formatCountryName, stripTrailingNumbers } from './location-utils';
import { getCountryFlagEmoji, getCountryNameFromCode } from './chat-utils';
import { hasOverlappingNames } from './string-utils';
import type { LocationDisplayMode } from '@/types/settings';

/**
 * Get the location part to append to stream title (or '').
 * Combines includeInTitle check with getLocationForStreamTitle.
 */
export function getStreamTitleLocationPart(
  rawLocation: LocationData | null | undefined,
  locationDisplay: LocationDisplayMode,
  customLocation: string | undefined,
  includeInTitle: boolean
): string {
  return includeInTitle ? getLocationForStreamTitle(rawLocation, locationDisplay, customLocation ?? '') : '';
}

/**
 * Get effective location string for stream title.
 * - hidden: '' (never show location)
 * - custom: customLocation text
 * - city/state/country: GPS-formatted
 */
export function getLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  locationDisplay: LocationDisplayMode,
  customLocation?: string
): string {
  if (locationDisplay === 'hidden') return '';
  if (locationDisplay === 'custom') return (customLocation ?? '').trim();
  return formatLocationForStreamTitle(rawLocation, locationDisplay);
}

/** Extract custom title from full Kick stream title (removes location part — flag prefix). */
export function parseStreamTitleToCustom(fullTitle: string): string {
  if (!fullTitle?.trim()) return '';
  const separatorsToTry = [' · ', ' - ', ' | '];
  for (const s of separatorsToTry) {
    const idx = fullTitle.indexOf(s);
    if (idx > 0) {
      const candidate = fullTitle.slice(0, idx).trim();
      const rest = fullTitle.slice(idx + s.length).trim();
      if (rest && candidate) return candidate;
    }
  }
  const flagMatch = fullTitle.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (flagMatch?.index != null && flagMatch.index > 0) {
    return fullTitle.slice(0, flagMatch.index).trim();
  }
  return fullTitle.trim();
}

/** Build full stream title: custom + space + location (flag/code is separator). */
export function buildStreamTitle(custom: string, location: string): string {
  const customTrimmed = custom.trim();
  if (!location) return customTrimmed;
  if (!customTrimmed) return location;
  return `${customTrimmed} ${location}`;
}

export function formatLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  display: 'city' | 'state' | 'country'
): string {
  if (!rawLocation) return '';

  const countryCode = (rawLocation.countryCode || '').toUpperCase();
  const country = rawLocation.country || getCountryNameFromCode(countryCode);
  const rawState = rawLocation.state || rawLocation.province || rawLocation.region;
  const rawCity =
    rawLocation.city ||
    rawLocation.municipality ||
    rawLocation.town ||
    rawLocation.county ||
    rawLocation.village ||
    rawLocation.hamlet;

  const state = rawState ? stripTrailingNumbers(rawState) : undefined;
  const city = rawCity ? stripTrailingNumbers(rawCity) : undefined;

  const flag = getCountryFlagEmoji(countryCode);
  const countryName = formatCountryName(country, countryCode);

  if (!flag && !countryName) return '';

  switch (display) {
    case 'country':
      return flag ? `${flag} ${countryName}` : countryName;
    case 'state': {
      if (!state || hasOverlappingNames(state, countryName)) {
        return flag ? `${flag} ${countryName}` : countryName;
      }
      return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
    }
    case 'city': {
      if (city) {
        // City option: city + state if state exists, else city + country
        const includeState = state && !hasOverlappingNames(city, state) && !hasOverlappingNames(state, countryName);
        if (hasOverlappingNames(city, countryName)) {
          return flag ? `${flag} ${city}` : city;
        }
        const locationPart = includeState
          ? `${city}, ${state}`
          : `${city}, ${countryName}`;
        return flag ? `${flag} ${locationPart}` : locationPart;
      }
      if (state && !hasOverlappingNames(state, countryName)) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    }
    default:
      return flag ? `${flag} ${countryName}` : countryName;
  }
}
