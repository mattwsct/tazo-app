import { kv } from '@vercel/kv';
import { getLocationData } from '@/utils/location-cache';

const CURRENCY_CACHE_KEY = 'convert_currency_cache';
const CURRENCY_CACHE_TTL_SEC = 3600; // 1 hour

// --- Country code → currency code mapping ---

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', KR: 'KRW', TW: 'TWD', HK: 'HKD', SG: 'SGD',
  TH: 'THB', VN: 'VND', MY: 'MYR', PH: 'PHP', ID: 'IDR', IN: 'INR',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', IL: 'ILS', TR: 'TRY',
  ZA: 'ZAR', EG: 'EGP', NG: 'NGN', KE: 'KES',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  CH: 'CHF', RU: 'RUB', UA: 'UAH',
  // Eurozone
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR',
  SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', MT: 'EUR',
  CY: 'EUR', HR: 'EUR',
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
  KRW: '₩', THB: '฿', INR: '₹', TRY: '₺', BRL: 'R$',
  PLN: 'zł', CZK: 'Kč', CHF: 'CHF', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', HUF: 'Ft', ILS: '₪', ZAR: 'R', MXN: '$',
  AUD: 'A$', CAD: 'C$', NZD: 'NZ$', HKD: 'HK$', SGD: 'S$', TWD: 'NT$',
};

// All valid 3-letter currency codes we support (for parsing detection)
const KNOWN_CURRENCIES = new Set([
  ...Object.values(COUNTRY_TO_CURRENCY),
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'NZD', 'CHF',
]);

// --- Unit aliases ---

const UNIT_ALIASES: Record<string, string> = {
  km: 'km', kilometer: 'km', kilometers: 'km', kilometres: 'km',
  mi: 'mi', mile: 'mi', miles: 'mi',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm',
  in: 'in', inch: 'in', inches: 'in', '"': 'in',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lbs', lbs: 'lbs', pound: 'lbs', pounds: 'lbs',
  c: 'c', celsius: 'c',
  f: 'f', fahrenheit: 'f',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  kmh: 'kmh', 'km/h': 'kmh', kph: 'kmh',
  mph: 'mph',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml',
  floz: 'floz', 'fl oz': 'floz',
};

// --- Parsing ---

type ParsedConvert =
  | { type: 'unit'; amount: number; unit: string }
  | { type: 'currency'; amount: number; from: string; to?: string }
  | { type: 'bare_number'; amount: number }
  | { type: 'default' };

export function parseConvertArgs(raw: string): ParsedConvert {
  const arg = raw.trim();
  if (!arg) return { type: 'default' };

  // Handle attached suffixes like "10km", "30c", "86f", "10\"", "6'"
  const attachedMatch = arg.match(/^(-?\d+(?:\.\d+)?)\s*(["']|[a-zA-Z/]+)$/);
  if (attachedMatch) {
    const amount = parseFloat(attachedMatch[1]);
    const rawUnit = attachedMatch[2].toLowerCase();
    const unit = UNIT_ALIASES[rawUnit];
    if (unit) return { type: 'unit', amount, unit };
    // Could be a currency code like "100usd"
    const upper = attachedMatch[2].toUpperCase();
    if (KNOWN_CURRENCIES.has(upper)) return { type: 'currency', amount, from: upper };
  }

  const parts = arg.split(/\s+/);

  // "!convert 100 km" or "!convert 100 usd" or "!convert 100 usd eur"
  if (parts.length >= 2) {
    const amount = parseFloat(parts[0]);
    if (!isNaN(amount)) {
      const rawUnit = parts[1].toLowerCase();
      const unit = UNIT_ALIASES[rawUnit];
      if (unit) return { type: 'unit', amount, unit };

      // Check for "fl oz" (two-word unit)
      if (parts.length >= 3 && `${parts[1]} ${parts[2]}`.toLowerCase() === 'fl oz') {
        return { type: 'unit', amount, unit: 'floz' };
      }

      // Currency: "100 usd" or "100 usd eur"
      const upper1 = parts[1].toUpperCase();
      if (KNOWN_CURRENCIES.has(upper1)) {
        if (parts.length >= 3) {
          const upper2 = parts[2].toUpperCase();
          if (KNOWN_CURRENCIES.has(upper2)) {
            return { type: 'currency', amount, from: upper1, to: upper2 };
          }
        }
        return { type: 'currency', amount, from: upper1 };
      }
    }
  }

  // Bare number: "!convert 500"
  if (parts.length === 1) {
    const amount = parseFloat(parts[0]);
    if (!isNaN(amount)) return { type: 'bare_number', amount };
  }

  return { type: 'default' };
}

// --- Unit conversion ---

export function convertUnit(amount: number, unit: string): string {
  switch (unit) {
    case 'km': {
      const mi = amount * 0.621371;
      return `📏 ${fmt(amount)} km = ${fmt(mi)} mi`;
    }
    case 'mi': {
      const km = amount / 0.621371;
      return `📏 ${fmt(amount)} mi = ${fmt(km)} km`;
    }
    case 'm': {
      const ft = amount * 3.28084;
      return `📏 ${fmt(amount)} m = ${fmt(ft)} ft`;
    }
    case 'ft': {
      const m = amount / 3.28084;
      return `📏 ${fmt(amount)} ft = ${fmt(m)} m`;
    }
    case 'cm': {
      const totalIn = amount * 0.393701;
      const feet = Math.floor(totalIn / 12);
      const inches = Math.round(totalIn % 12);
      return `📏 ${fmt(amount)} cm = ${feet}'${inches}" (${fmt(totalIn)} in)`;
    }
    case 'in': {
      const cm = amount / 0.393701;
      return `📏 ${fmt(amount)} in = ${fmt(cm)} cm`;
    }
    case 'kg': {
      const lbs = amount * 2.20462;
      return `⚖️ ${fmt(amount)} kg = ${fmt(lbs)} lbs`;
    }
    case 'lbs': {
      const kg = amount / 2.20462;
      return `⚖️ ${fmt(amount)} lbs = ${fmt(kg)} kg`;
    }
    case 'c': {
      const f = (amount * 9 / 5) + 32;
      return `🌡️ ${fmt(amount)}°C = ${fmt(f)}°F`;
    }
    case 'f': {
      const c = (amount - 32) * 5 / 9;
      return `🌡️ ${fmt(amount)}°F = ${fmt(c)}°C`;
    }
    case 'l': {
      const gal = amount * 0.264172;
      return `📏 ${fmt(amount)} L = ${fmt(gal)} gal`;
    }
    case 'gal': {
      const l = amount / 0.264172;
      return `📏 ${fmt(amount)} gal = ${fmt(l)} L`;
    }
    case 'kmh': {
      const mph = amount * 0.621371;
      return `📏 ${fmt(amount)} km/h = ${fmt(mph)} mph`;
    }
    case 'mph': {
      const kmh = amount / 0.621371;
      return `📏 ${fmt(amount)} mph = ${fmt(kmh)} km/h`;
    }
    case 'ml': {
      const floz = amount * 0.033814;
      return `📏 ${fmt(amount)} mL = ${fmt(floz)} fl oz`;
    }
    case 'floz': {
      const ml = amount / 0.033814;
      return `📏 ${fmt(amount)} fl oz = ${fmt(ml)} mL`;
    }
    default:
      return `📏 Unknown unit: ${unit}`;
  }
}

function fmt(n: number): string {
  if (Number.isInteger(n) || Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

// --- Currency conversion ---

async function getLocalCurrency(): Promise<{ code: string; country?: string } | null> {
  try {
    const loc = await getLocationData();
    const cc = loc?.location?.countryCode?.toUpperCase();
    if (!cc) return null;
    const currency = COUNTRY_TO_CURRENCY[cc];
    if (!currency) return null;
    return { code: currency, country: loc?.location?.country ?? undefined };
  } catch {
    return null;
  }
}

interface CachedRate {
  from: string;
  to: string;
  rate: number;
  cachedAt: number;
}

async function fetchRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;

  const cacheKey = `${CURRENCY_CACHE_KEY}:${from}:${to}`;
  try {
    const cached = await kv.get<CachedRate>(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CURRENCY_CACHE_TTL_SEC * 1000) {
      return cached.rate;
    }
  } catch { /* proceed to fetch */ }

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}&amount=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[to];
    if (typeof rate !== 'number') return null;

    try {
      await kv.set(cacheKey, { from, to, rate, cachedAt: Date.now() } as CachedRate, { ex: CURRENCY_CACHE_TTL_SEC });
    } catch { /* non-critical */ }

    return rate;
  } catch {
    return null;
  }
}

function formatCurrency(amount: number, code: string): string {
  const sym = CURRENCY_SYMBOLS[code] ?? '';
  const isZeroDecimal = ['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'HUF', 'ISK'].includes(code);
  const formatted = isZeroDecimal
    ? Math.round(amount).toLocaleString()
    : amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (sym && sym.length <= 2) return `${sym}${formatted} ${code}`;
  return `${formatted} ${code}`;
}

export async function handleConvertCurrency(
  amount: number,
  from: string,
  to?: string
): Promise<string> {
  const local = await getLocalCurrency();
  const fromCode = from.toUpperCase();

  let toCode: string;
  if (to) {
    toCode = to.toUpperCase();
  } else if (local && fromCode === local.code) {
    toCode = 'USD';
  } else if (local) {
    toCode = local.code;
  } else {
    toCode = 'USD';
  }

  if (fromCode === toCode) return `💱 ${formatCurrency(amount, fromCode)} = ${formatCurrency(amount, toCode)} (same currency)`;

  const rate = await fetchRate(fromCode, toCode);
  if (rate === null) return `💱 Could not fetch ${fromCode} → ${toCode} rate. Try again later.`;

  const converted = amount * rate;
  return `💱 ${formatCurrency(amount, fromCode)} = ${formatCurrency(converted, toCode)}`;
}

export async function handleConvertBareNumber(amount: number): Promise<string> {
  const local = await getLocalCurrency();
  if (!local || local.code === 'USD') {
    return `💱 Couldn't determine local currency. Try !convert ${Math.round(amount)} usd jpy`;
  }
  return handleConvertCurrency(amount, local.code, 'USD');
}

export async function handleConvertDefault(): Promise<string> {
  const local = await getLocalCurrency();
  if (!local || local.code === 'USD') {
    return `💱 Couldn't determine local currency. Try !convert 100 usd jpy`;
  }
  return handleConvertCurrency(100, 'USD', local.code);
}
