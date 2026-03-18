/**
 * Format location for stream title display.
 * One setting (locationDisplay) drives overlay, chat, stream title, and minimap.
 * - hidden: no location in stream title, minimap hidden
 * - custom: custom text on overlay AND stream title
 * - suburb/city/state/country: GPS-based precision
 */

import type { LocationData } from './location-utils';
import { formatCountryName } from './location-utils';
import { getLocationByPrecision } from './location/precision';
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
 * - suburb/city/state/country: GPS-formatted
 */
export function getLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  locationDisplay: LocationDisplayMode,
  customLocation?: string
): string {
  if (locationDisplay === 'hidden') return '';
  if (locationDisplay === 'custom') return (customLocation ?? '').trim();
  return formatLocationForStreamTitle(rawLocation, locationDisplay as 'suburb' | 'city' | 'state' | 'country');
}

/** Extract custom title from full Kick stream title (removes location part — flag prefix). */
export function parseStreamTitleToCustom(fullTitle: string): string {
  if (!fullTitle?.trim()) return '';
  // Strip goal suffixes added by buildStreamTitle before separator-based parsing
  const withoutGoals = fullTitle
    .replace(/\s+🎁 Subs:\s*\d+\/\d+(\s+💚 Kicks:\s*\d+\/\d+)?/, '')
    .replace(/\s+💚 Kicks:\s*\d+\/\d+/, '')
    .trim();
  const separatorsToTry = [' · ', ' - '];
  for (const s of separatorsToTry) {
    const idx = withoutGoals.indexOf(s);
    if (idx > 0) {
      const candidate = withoutGoals.slice(0, idx).trim();
      const rest = withoutGoals.slice(idx + s.length).trim();
      if (rest && candidate) return candidate;
    }
  }
  const flagMatch = withoutGoals.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (flagMatch?.index != null && flagMatch.index > 0) {
    return withoutGoals.slice(0, flagMatch.index).trim();
  }
  return withoutGoals;
}

/** Build full stream title: custom + location + optional goals suffix (🎁 Subs: n/t | 💰 Kicks: n/t). */
export function buildStreamTitle(
  custom: string,
  location: string,
  subInfo?: { current: number; target: number },
  kicksInfo?: { current: number; target: number }
): string {
  const customTrimmed = custom.trim();
  const goalParts: string[] = [];
  if (subInfo != null && subInfo.target > 0) {
    goalParts.push(`🎁 Subs: ${subInfo.current}/${subInfo.target}`);
  }
  if (kicksInfo != null && kicksInfo.target > 0) {
    goalParts.push(`💚 Kicks: ${kicksInfo.current}/${kicksInfo.target}`);
  }
  const goalSuffix = goalParts.length > 0 ? ` ${goalParts.join(' ')}` : '';
  if (!location) return `${customTrimmed}${goalSuffix}`;
  if (!customTrimmed) return `${location}${goalSuffix}`;
  return `${customTrimmed} ${location}${goalSuffix}`;
}

export function formatLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  display: 'suburb' | 'city' | 'state' | 'country'
): string {
  if (!rawLocation) return '';

  const countryCode = (rawLocation.countryCode || '').toUpperCase();
  const country = rawLocation.country || getCountryNameFromCode(countryCode);
  const flag = getCountryFlagEmoji(countryCode);
  const countryName = formatCountryName(country, countryCode);

  if (!flag && !countryName) return '';

  // Use getLocationByPrecision for name resolution — same function the overlay uses.
  // This applies identical rules: 16-char limit, Latin-script check, generic-name filter,
  // admin-suffix/trailing-number stripping, and the same field fallback chains.
  switch (display) {
    case 'country':
      return flag ? `${flag} ${countryName}` : countryName;
    case 'state': {
      const { name: state } = getLocationByPrecision(rawLocation, 'state');
      if (state && !hasOverlappingNames(state, countryName)) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      // Fall back to city (same as overlay) before going to country-only
      const { name: city } = getLocationByPrecision(rawLocation, 'city');
      if (city && !hasOverlappingNames(city, countryName)) {
        return flag ? `${flag} ${city}, ${countryName}` : `${city}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    }
    case 'suburb': {
      const { name: suburb } = getLocationByPrecision(rawLocation, 'suburb');
      if (suburb) {
        if (hasOverlappingNames(suburb, countryName)) return flag ? `${flag} ${suburb}` : suburb;
        return flag ? `${flag} ${suburb}, ${countryName}` : `${suburb}, ${countryName}`;
      }
      const { name: state } = getLocationByPrecision(rawLocation, 'state');
      if (state && !hasOverlappingNames(state, countryName)) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    }
    case 'city': {
      const { name: city } = getLocationByPrecision(rawLocation, 'city');
      if (city) {
        if (hasOverlappingNames(city, countryName)) return flag ? `${flag} ${city}` : city;
        return flag ? `${flag} ${city}, ${countryName}` : `${city}, ${countryName}`;
      }
      const { name: state } = getLocationByPrecision(rawLocation, 'state');
      if (state && !hasOverlappingNames(state, countryName)) {
        return flag ? `${flag} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return flag ? `${flag} ${countryName}` : countryName;
    }
    default:
      return flag ? `${flag} ${countryName}` : countryName;
  }
}
