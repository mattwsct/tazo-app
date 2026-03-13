import { getPersistentLocation } from './location-cache';

export const COUNTRY_CURRENCY: Record<string, string> = {
  AU: 'AUD', AT: 'EUR', BE: 'EUR', BR: 'BRL', CA: 'CAD', CN: 'CNY',
  CZ: 'CZK', DK: 'DKK', FI: 'EUR', FR: 'EUR', DE: 'EUR', GR: 'EUR',
  HK: 'HKD', HU: 'HUF', IN: 'INR', ID: 'IDR', IE: 'EUR', IL: 'ILS',
  IT: 'EUR', JP: 'JPY', KR: 'KRW', MX: 'MXN', NL: 'EUR', NZ: 'NZD',
  NO: 'NOK', PL: 'PLN', PT: 'EUR', RO: 'RON', RU: 'RUB', SA: 'SAR',
  SG: 'SGD', ZA: 'ZAR', ES: 'EUR', SE: 'SEK', CH: 'CHF', TH: 'THB',
  TR: 'TRY', UA: 'UAH', GB: 'GBP', US: 'USD', AE: 'AED', AR: 'ARS',
  CL: 'CLP', CO: 'COP', EG: 'EGP', MY: 'MYR', PH: 'PHP', PK: 'PKR',
  TW: 'TWD', VN: 'VND', NG: 'NGN', KE: 'KES', GH: 'GHS',
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
