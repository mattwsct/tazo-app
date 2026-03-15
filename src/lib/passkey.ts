/**
 * WebAuthn / Passkey helpers.
 * RP settings are derived from NEXT_PUBLIC_APP_URL (production)
 * or fall back to localhost for local dev.
 */

export function getRpSettings(): { rpName: string; rpID: string; origin: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = new URL(appUrl);
  return {
    rpName: 'tazo.wtf',
    rpID: url.hostname,        // 'tazo.wtf' or 'localhost'
    origin: url.origin,        // 'https://tazo.wtf' or 'http://localhost:3000'
  };
}

export const PASSKEY_CHALLENGE_KEY = 'passkey_challenge';
export const PASSKEY_CHALLENGE_TTL = 120; // seconds
