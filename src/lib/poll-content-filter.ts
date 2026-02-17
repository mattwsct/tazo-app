/**
 * Content filter for poll options and messages displayed on the overlay.
 * Blocks slurs, profanity, and variations (leetspeak, special chars).
 * Add terms to BLOCKED_TERMS as needed.
 */

const BLOCKED_TERMS = new Set([
  // Profanity + common variations (leetspeak handled by normalizeForCheck)
  'fuck', 'fucking', 'fucker', 'fucked', 'fck', 'fuk', 'fvck', 'phuck', 'fuc', 'fock',
  'shit', 'shitty', 'bullshit', 'sht', 'sh1t', 'a55', 'ass', 'asshole', 'ashole',
  'bitch', 'b1tch', 'btch', 'bastard', 'dumbass', 'dipshit', 'damn',
  'dick', 'd1ck', 'cock', 'cunt', 'cnt', 'pussy', 'puss', 'whore', 'slut',
  // Slurs and hate speech - add more to this list as needed
  'nigger', 'nigga', 'niggas', 'n1gger', 'n1gga', 'ni99er', 'ni99a',
  'fag', 'faggot', 'fags', 'f4g', 'f4ggot', 'fggt',
  'retard', 'retarded', 'r3tard', 'r3tarded', 'rtard',
  'tranny', 'rape', 'rapist', 'raping', 'r4pe', 'pedo', 'pedophile', 'childporn', 'cporn',
  'kike', 'spic', 'beaner', 'chink', 'gook', 'coon', 'paki', 'raghead', 'towelhead',
  'wetback', 'darkie', 'negro', 'jigaboo', 'jiggaboo', 'jiggerboo',
]);

const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '€': 'e', '$': 's', '+': 't',
};

/** Normalize for blocklist matching: lowercase, leetspeak, remove non-alphanumeric, collapse repeats */
function normalizeForCheck(s: string): string {
  let out = s.toLowerCase().replace(/[^a-z0-9]/gi, '');
  for (const [char, repl] of Object.entries(LEET_MAP)) {
    out = out.split(char).join(repl);
  }
  out = out.replace(/(.)\1+/g, '$1');
  return out;
}

/** Check if text contains any blocked term (after normalization) */
export function containsBlockedContent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const norm = normalizeForCheck(text);
  for (const term of BLOCKED_TERMS) {
    const termNorm = normalizeForCheck(term);
    if (termNorm.length >= 2 && norm.includes(termNorm)) return true;
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
