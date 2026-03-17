import { getPersistentLocation } from './location-cache';

/**
 * Canonical country code → currency code mapping.
 * This is the single source of truth — both local-currency.ts and convert-utils.ts use this.
 * Union of all entries from both files; entries unique to convert-utils (QA, KW, PE, IS, BG,
 * SK, SI, EE, LV, LT, MT, CY, HR, LU) are included here.
 */
export const COUNTRY_CURRENCY: Record<string, string> = {
  // Americas
  US: 'USD', CA: 'CAD', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Europe — non-euro
  GB: 'GBP', SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  CH: 'CHF', RU: 'RUB', UA: 'UAH',
  // Europe — Eurozone
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR',
  SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', MT: 'EUR',
  CY: 'EUR', HR: 'EUR',
  // Asia-Pacific
  AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', KR: 'KRW', TW: 'TWD', HK: 'HKD', SG: 'SGD',
  TH: 'THB', VN: 'VND', MY: 'MYR', PH: 'PHP', ID: 'IDR', IN: 'INR',
  // Middle East
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', IL: 'ILS', TR: 'TRY',
  // Africa
  ZA: 'ZAR', EG: 'EGP', NG: 'NGN', KE: 'KES', GH: 'GHS',
  // South/Southeast Asia extras
  PK: 'PKR',
};

/**
 * Returns { currency, rate } for the given country (or the streamer's RTIRL location as fallback),
 * or undefined if currency is USD or unavailable.
 *
 * @param countryCode - ISO 3166-1 alpha-2 code (e.g. "AU"). When provided, RTIRL lookup is skipped.
 *                      Pass the Vercel IP header value for reliable detection without RTIRL.
 *
 * Exchange rate is cached via Next.js fetch revalidate (1 hour).
 */
export async function getLocalCurrencyContext(countryCode?: string): Promise<{ currency: string; rate: number } | undefined> {
  try {
    let code = countryCode?.toUpperCase();
    if (!code) {
      // Fallback: try RTIRL persistent location
      const loc = await getPersistentLocation();
      code = loc?.location?.countryCode?.toUpperCase();
    }
    if (!code) return undefined;
    const currency = COUNTRY_CURRENCY[code];
    if (!currency || currency === 'USD') return undefined;
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 3600 } });
    if (!res.ok) return undefined;
    const data = await res.json() as { rates?: Record<string, number> };
    const rate = data.rates?.[currency];
    if (!rate) return undefined;
    return { currency, rate };
  } catch {
    return undefined;
  }
}
