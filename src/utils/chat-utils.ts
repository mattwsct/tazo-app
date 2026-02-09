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
 * Gets city-level location name for chat commands
 */
export function getCityLocationForChat(location: LocationData | null): string {
  if (!location) return '';
  
  const city = getBestCityName(location);
  const country = location.countryCode || location.country || '';
  
  if (city && country) {
    return `${city}, ${country}`;
  }
  
  return city || country || '';
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
  if (coord == null) return coord;
  return Math.round(coord * 1000) / 1000;
}

/**
 * Gets display label for location-based commands
 */
export function getDisplayLabel(hasQuery: boolean, label: string): string {
  const cleanLabel = label ? label.replace(/(: |→ )$/, '') : '';
  return cleanLabel ? `${cleanLabel} → ` : '';
}
