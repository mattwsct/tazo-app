/**
 * Zero-dependency currency constants — safe to import in both client and server code.
 * convert-utils.ts and local-currency.ts both import from here.
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
 * Currencies that are always displayed without decimal places.
 * Used by formatCurrency (convert-utils), StreamPanel, and ChallengesBox.
 * RWF and BIF are small-denomination currencies always quoted as integers.
 */
export const NO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'IDR', 'HUF', 'CLP', 'COP', 'RWF', 'BIF', 'THB', 'ISK',
]);
