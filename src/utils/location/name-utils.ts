export const MAX_CHARACTER_LIMIT = 16; // Single limit for both primary and secondary lines

/**
 * Checks if a string contains only Latin script (including accented and extended characters)
 */
export function isLatinScript(name: string): boolean {
  if (!name) return false;

  const trimmed = name.trim();

  const nonLatinPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF\uAC00-\uD7AF\u0E00-\u0E7F\u0590-\u05FF]/;

  if (nonLatinPattern.test(trimmed)) {
    return false;
  }

  const latinPattern = /^[\u0020-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\s\-'.,0-9]+$/;

  return latinPattern.test(trimmed);
}

/**
 * Strips trailing numbers from location names (e.g. "Honcho 6" -> "Honcho").
 */
export function stripTrailingNumbers(name: string): string {
  if (!name || typeof name !== 'string') return name;
  return name.replace(/\s+\d+$/, '').trim() || name;
}

/**
 * Names where " City" or " Municipality" is a genuine part of the proper noun.
 */
const ADMIN_SUFFIX_WHITELIST = new Set([
  'mexico city', 'kansas city', 'oklahoma city', 'salt lake city',
  'ho chi minh city', 'new york city', 'jersey city', 'iowa city',
  'jefferson city', 'junction city', 'rapid city', 'traverse city',
  'carson city', 'dodge city', 'bay city', 'sun city', 'park city',
  'league city', 'garden city', 'universal city', 'culver city',
  'foster city', 'daly city', 'temple city', 'quezon city',
  'davao city', 'cebu city', 'pasay city', 'makati city',
  'paranaque city', 'panama city',
]);

/**
 * Strips bureaucratic administrative suffixes that nobody uses in speech.
 */
export function stripAdminSuffix(name: string): string {
  if (!name) return name;
  if (ADMIN_SUFFIX_WHITELIST.has(name.toLowerCase())) return name;
  return name
    .replace(/ City$/i, '')
    .replace(/ Municipality$/i, '')
    .trim() || name;
}

/**
 * Generic suburb/neighbourhood names that give no useful location information.
 */
const GENERIC_NEIGHBOURHOOD_NAMES = new Set([
  'downtown', 'midtown', 'uptown', 'central', 'cbd',
  'old town', 'old city', 'city centre', 'city center',
  'waterfront', 'riverside', 'lakeside', 'harbour', 'harbor',
  'beachfront', 'bayside', 'hillside', 'hillcrest',
  'northside', 'southside', 'eastside', 'westside',
]);

/**
 * Returns true if a suburb/neighbourhood name is too generic to be worth displaying.
 */
export function isGenericNeighbourhood(name: string): boolean {
  return GENERIC_NEIGHBOURHOOD_NAMES.has(name.toLowerCase().trim());
}

/**
 * Validates location names for display (length, script, not just a number).
 */
export function isValidLocationName(name: string): boolean {
  if (!name || name.length > MAX_CHARACTER_LIMIT) return false;
  if (!isLatinScript(name)) return false;
  if (/^\d+$/.test(name.trim())) return false;
  return true;
}

/**
 * Normalizes location names for display.
 */
export function normalizeToEnglish(name: string): string {
  return name ? name.trim() : name;
}

/**
 * Cleans a raw location name for display.
 */
export function cleanForDisplay(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = stripAdminSuffix(stripTrailingNumbers(value));
  if (!cleaned || !isValidLocationName(cleaned)) return null;
  return normalizeToEnglish(cleaned);
}
