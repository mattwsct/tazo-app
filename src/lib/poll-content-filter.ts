/**
 * Content filter for poll options and messages displayed on the overlay.
 * Blocks slurs, profanity, and variations (leetspeak, special chars).
 * Add terms to BLOCKED_TERMS as needed.
 */

/** Worst-of-worst terms only. Mild swears (damn, shit, ass, bitch) allowed for under-18. */
const BLOCKED_TERMS = new Set([
  // Strong profanity
  'fuck', 'fucking', 'fucker', 'fucked', 'fck', 'fuk', 'fvck', 'phuck', 'fuc', 'fock',
  'cunt', 'cnt',
  // Slurs and hate speech
  'nigger', 'nigga', 'niggas', 'n1gger', 'n1gga', 'ni99er', 'ni99a',
  'fag', 'faggot', 'fags', 'f4g', 'f4ggot', 'fggt',
  'retard', 'retarded', 'r3tard', 'r3tarded', 'rtard',
  'tranny', 'kike', 'spic', 'beaner', 'chink', 'gook', 'coon', 'paki', 'raghead', 'towelhead',
  'wetback', 'darkie', 'negro', 'jigaboo', 'jiggaboo', 'jiggerboo',
  // Sexual violence and CSAM
  'rape', 'rapist', 'raping', 'r4pe', 'pedo', 'pedophile', 'childporn', 'cporn',
]);

const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '€': 'e', '$': 's', '+': 't',
};

/** Normalize for blocklist matching: lowercase, leetspeak, remove non-alphanumeric. */
function normalizeForCheck(s: string): string {
  let out = s.toLowerCase().replace(/[^a-z0-9]/gi, '');
  for (const [char, repl] of Object.entries(LEET_MAP)) {
    out = out.split(char).join(repl);
  }
  return out;
}

/** Check if text contains any blocked term. Word-boundary only (exact match per word) to avoid false positives (e.g. "ass" in "class", "glass", "last"). */
export function containsBlockedContent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const words = text.split(/\W+/).map((w) => w.replace(/[^a-z0-9]/gi, '')).filter((w) => w.length >= 2);
  const blockedNorm = new Set([...BLOCKED_TERMS].map((t) => normalizeForCheck(t)));
  for (const word of words) {
    const wordNorm = normalizeForCheck(word);
    if (wordNorm.length >= 2 && blockedNorm.has(wordNorm)) return true;
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
