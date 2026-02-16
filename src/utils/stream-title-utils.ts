/**
 * Format location for stream title display.
 * Avoids duplication like "Tokyo, Tokyo, Japan" — same logic as overlay page.
 */

import type { LocationData } from './location-utils';
import { formatCountryName } from './location-utils';
import { getCountryFlagEmoji, getCountryNameFromCode } from './chat-utils';

export type StreamTitleLocationDisplay = 'country' | 'country_state' | 'country_city';

/** 'emoji' = 🇯🇵 (may not render on some devices), 'code' = [JP] (always renders) */
export type StreamTitleLocationPrefix = 'emoji' | 'code';

/** Extract custom title from full Kick stream title (removes location part — flag or [CC] prefix). */
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
  const codeMatch = fullTitle.match(/\s\[[A-Za-z]{2}\]/);
  if (codeMatch?.index != null && codeMatch.index > 0) {
    return fullTitle.slice(0, codeMatch.index).trim();
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

function hasOverlappingNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  const w1 = n1.split(/\s+/).filter((w) => w.length > 0);
  const w2 = n2.split(/\s+/).filter((w) => w.length > 0);
  if (w1.length === 0 || w2.length === 0) return false;
  const shorter = w1.length <= w2.length ? w1 : w2;
  const longer = w1.length > w2.length ? w1 : w2;
  if (shorter.every((word) => longer.includes(word))) return true;
  const common = shorter.filter((w) => longer.includes(w));
  return common.length >= 2;
}

export function formatLocationForStreamTitle(
  rawLocation: LocationData | null | undefined,
  display: StreamTitleLocationDisplay,
  prefixStyle: StreamTitleLocationPrefix = 'emoji'
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

  const flagEmoji = getCountryFlagEmoji(countryCode);
  const countryName = formatCountryName(country, countryCode);
  const prefix = prefixStyle === 'code' && countryCode ? `[${countryCode}]` : flagEmoji;

  if (!prefix && !countryName) return '';

  switch (display) {
    case 'country':
      return prefix ? `${prefix} ${countryName}` : countryName;
    case 'country_state': {
      if (!state || hasOverlappingNames(state, countryName)) {
        return prefix ? `${prefix} ${countryName}` : countryName;
      }
      return prefix ? `${prefix} ${state}, ${countryName}` : `${state}, ${countryName}`;
    }
    case 'country_city': {
      if (city) {
        const includeState = state && !hasOverlappingNames(city, state) && !hasOverlappingNames(state, countryName);
        const suffix = includeState ? `${state}, ${countryName}` : countryName;
        if (hasOverlappingNames(city, countryName)) {
          return prefix ? `${prefix} ${city}` : city;
        }
        return prefix ? `${prefix} ${city}, ${suffix}` : `${city}, ${suffix}`;
      }
      if (state && !hasOverlappingNames(state, countryName)) {
        return prefix ? `${prefix} ${state}, ${countryName}` : `${state}, ${countryName}`;
      }
      return prefix ? `${prefix} ${countryName}` : countryName;
    }
    default:
      return prefix ? `${prefix} ${countryName}` : countryName;
  }
}
