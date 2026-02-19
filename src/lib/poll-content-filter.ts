/**
 * Content filter for poll options and messages displayed on the overlay.
 * Simple whole-word match only — no leetspeak normalization to avoid false positives.
 */

/** Slurs and severe profanity only. Whole-word match, case-insensitive. */
const BLOCKED_TERMS = new Set([
  'fuck', 'fucking', 'fucker', 'fucked',
  'cunt',
  'nigger', 'nigga', 'niggas',
  'faggot', 'fags',
  'retard', 'retarded',
  'tranny', 'kike', 'spic', 'beaner', 'chink', 'gook', 'coon', 'raghead', 'towelhead',
  'wetback', 'darkie', 'negro', 'jigaboo', 'jiggaboo', 'jiggerboo',
  'rape', 'rapist', 'raping',
  'pedo', 'pedophile', 'childporn', 'cporn',
]);

/** Check if text contains any blocked term. Whole words only (e.g. "ass" in "class" does NOT match). */
export function containsBlockedContent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
  for (const word of words) {
    if (BLOCKED_TERMS.has(word)) return true;
  }
  return false;
}

/** Allowed display chars: letters, numbers, spaces, basic punctuation. Strips emojis/symbols. */
const DISPLAY_REGEX = /[^\w\s.,!?'-]/g;

/**
 * Filter a poll option label for overlay display.
 * Returns lowercase, sanitized label (no special chars) or "[filtered]" if blocked.
 */
export function filterOptionForDisplay(label: string): string {
  if (!label || typeof label !== 'string') return '';
  if (containsBlockedContent(label)) return '[filtered]';
  const sanitized = label
    .replace(DISPLAY_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return sanitized || '[filtered]';
}

/**
 * Filter a string for overlay display (e.g. poll question, winner message).
 * Returns sanitized lowercase text, or "[filtered]" if it contains blocked content.
 */
export function filterTextForDisplay(text: string): string {
  if (!text || typeof text !== 'string') return '';
  if (containsBlockedContent(text)) return '[filtered]';
  const out = text.toLowerCase().replace(DISPLAY_REGEX, ' ').replace(/\s+/g, ' ').trim();
  return out || '[filtered]';
}
