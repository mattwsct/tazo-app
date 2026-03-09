import { type LocationDisplay } from '../location-utils';

// Country coordinate ranges
interface CountryBounds {
  name: string;
  code: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

const COUNTRY_BOUNDS: CountryBounds[] = [
  { name: 'United States', code: 'us', latMin: 24, latMax: 49, lonMin: -125, lonMax: -66 },
  { name: 'Canada', code: 'ca', latMin: 42, latMax: 84, lonMin: -141, lonMax: -52 },
  { name: 'Mexico', code: 'mx', latMin: 14, latMax: 33, lonMin: -118, lonMax: -86 },
  { name: 'Japan', code: 'jp', latMin: 24, latMax: 46, lonMin: 122, lonMax: 146 },
  { name: 'United Kingdom', code: 'gb', latMin: 50, latMax: 61, lonMin: -8, lonMax: 2 },
  { name: 'Australia', code: 'au', latMin: -44, latMax: -10, lonMin: 113, lonMax: 154 },
  { name: 'Germany', code: 'de', latMin: 47, latMax: 55, lonMin: 6, lonMax: 15 },
  { name: 'France', code: 'fr', latMin: 42, latMax: 51, lonMin: -5, lonMax: 8 },
  { name: 'China', code: 'cn', latMin: 18, latMax: 54, lonMin: 73, lonMax: 135 },
  { name: 'India', code: 'in', latMin: 6, latMax: 37, lonMin: 68, lonMax: 97 },
  { name: 'Brazil', code: 'br', latMin: -34, latMax: 5, lonMin: -74, lonMax: -34 },
  { name: 'Russia', code: 'ru', latMin: 41, latMax: 82, lonMin: 19, lonMax: 169 },
  { name: 'Spain', code: 'es', latMin: 36, latMax: 44, lonMin: -10, lonMax: 5 },
  { name: 'Portugal', code: 'pt', latMin: 37, latMax: 42, lonMin: -10, lonMax: -6 },
  { name: 'Italy', code: 'it', latMin: 36, latMax: 47, lonMin: 6, lonMax: 19 },
  { name: 'South Korea', code: 'kr', latMin: 33, latMax: 39, lonMin: 124, lonMax: 132 },
  { name: 'Thailand', code: 'th', latMin: 5, latMax: 21, lonMin: 97, lonMax: 106 },
  { name: 'Vietnam', code: 'vn', latMin: 8, latMax: 24, lonMin: 102, lonMax: 110 },
  { name: 'Philippines', code: 'ph', latMin: 5, latMax: 21, lonMin: 116, lonMax: 127 },
  { name: 'Indonesia', code: 'id', latMin: -11, latMax: 6, lonMin: 95, lonMax: 141 },
  { name: 'New Zealand', code: 'nz', latMin: -47, latMax: -34, lonMin: 166, lonMax: 179 },
  { name: 'South Africa', code: 'za', latMin: -35, latMax: -22, lonMin: 16, lonMax: 33 },
  { name: 'Argentina', code: 'ar', latMin: -56, latMax: -21, lonMin: -74, lonMax: -53 },
  { name: 'Chile', code: 'cl', latMin: -56, latMax: -17, lonMin: -76, lonMax: -66 },
];

/**
 * Estimates country code from coordinates when LocationIQ doesn't provide it
 */
export function estimateCountryCodeFromCoords(lat: number, lon: number): string | null {
  const country = COUNTRY_BOUNDS.find(
    (c) => lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
  );
  return country?.code || null;
}

/**
 * Estimates country from coordinates using basic geographic ranges
 */
function estimateCountryFromCoords(lat: number, lon: number): { name: string; code: string; isWater?: boolean } | null {
  const country = COUNTRY_BOUNDS.find(
    (c) => lat >= c.latMin && lat <= c.latMax && lon >= c.lonMin && lon <= c.lonMax
  );
  if (country) {
    return { name: country.name, code: country.code };
  }

  // Major seas and gulfs
  if (lat >= 18 && lat <= 31 && lon >= -98 && lon <= -80) return { name: 'Gulf of Mexico', code: '', isWater: true };
  if (lat >= 9 && lat <= 25 && lon >= -89 && lon <= -60) return { name: 'Caribbean Sea', code: '', isWater: true };
  if (lat >= 30 && lat <= 46 && lon >= -6 && lon <= 37) return { name: 'Mediterranean Sea', code: '', isWater: true };
  if (lat >= 40 && lat <= 47 && lon >= 27 && lon <= 42) return { name: 'Black Sea', code: '', isWater: true };
  if (lat >= 12 && lat <= 30 && lon >= 32 && lon <= 44) return { name: 'Red Sea', code: '', isWater: true };
  if (lat >= 0 && lat <= 25 && lon >= 50 && lon <= 78) return { name: 'Arabian Sea', code: '', isWater: true };
  if (lat >= 5 && lat <= 22 && lon >= 80 && lon <= 100) return { name: 'Bay of Bengal', code: '', isWater: true };
  if (lat >= 0 && lat <= 25 && lon >= 105 && lon <= 121) return { name: 'South China Sea', code: '', isWater: true };
  if (lat >= 24 && lat <= 35 && lon >= 120 && lon <= 130) return { name: 'East China Sea', code: '', isWater: true };
  if (lat >= 35 && lat <= 52 && lon >= 127 && lon <= 142) return { name: 'Sea of Japan', code: '', isWater: true };
  if (lat >= 33 && lat <= 41 && lon >= 119 && lon <= 127) return { name: 'Yellow Sea', code: '', isWater: true };
  if (lat >= 51 && lat <= 62 && lon >= -4 && lon <= 9) return { name: 'North Sea', code: '', isWater: true };
  if (lat >= 53 && lat <= 66 && lon >= 9 && lon <= 31) return { name: 'Baltic Sea', code: '', isWater: true };
  if (lat >= 52 && lat <= 66 && lon >= -180 && lon <= -157) return { name: 'Bering Sea', code: '', isWater: true };
  if (lat >= 54 && lat <= 60 && lon >= -160 && lon <= -140) return { name: 'Gulf of Alaska', code: '', isWater: true };
  if (lat >= 23 && lat <= 32 && lon >= -115 && lon <= -107) return { name: 'Gulf of California', code: '', isWater: true };
  if (lat >= 24 && lat <= 30 && lon >= 48 && lon <= 57) return { name: 'Persian Gulf', code: '', isWater: true };
  if (lat >= 11 && lat <= 15 && lon >= 42 && lon <= 52) return { name: 'Gulf of Aden', code: '', isWater: true };
  if (lat >= 5 && lat <= 15 && lon >= 92 && lon <= 100) return { name: 'Andaman Sea', code: '', isWater: true };
  if (lat >= -7 && lat <= 5 && lon >= 105 && lon <= 116) return { name: 'Java Sea', code: '', isWater: true };
  if (lat >= 0 && lat <= 35 && lon >= 120 && lon <= 140) return { name: 'Philippine Sea', code: '', isWater: true };
  if (lat >= -30 && lat <= -10 && lon >= 145 && lon <= 165) return { name: 'Coral Sea', code: '', isWater: true };
  if (lat >= -48 && lat <= -30 && lon >= 150 && lon <= 175) return { name: 'Tasman Sea', code: '', isWater: true };
  if (lat >= 7 && lat <= 13 && lon >= 99 && lon <= 105) return { name: 'Gulf of Thailand', code: '', isWater: true };
  if (lat >= 5 && lat <= 12 && lon >= 118 && lon <= 122) return { name: 'Sulu Sea', code: '', isWater: true };
  if (lat >= 0 && lat <= 6 && lon >= 118 && lon <= 125) return { name: 'Celebes Sea', code: '', isWater: true };
  if (lat >= -8 && lat <= -4 && lon >= 125 && lon <= 130) return { name: 'Banda Sea', code: '', isWater: true };
  if (lat >= -12 && lat <= -5 && lon >= 130 && lon <= 141) return { name: 'Arafura Sea', code: '', isWater: true };
  if (lat >= -14 && lat <= -9 && lon >= 122 && lon <= 130) return { name: 'Timor Sea', code: '', isWater: true };
  if (lat >= -2 && lat <= 7 && lon >= -10 && lon <= 9) return { name: 'Gulf of Guinea', code: '', isWater: true };
  if (lat >= 40 && lat <= 46 && lon >= 12 && lon <= 20) return { name: 'Adriatic Sea', code: '', isWater: true };
  if (lat >= 35 && lat <= 41 && lon >= 23 && lon <= 30) return { name: 'Aegean Sea', code: '', isWater: true };
  if (lat >= 36 && lat <= 40 && lon >= 18 && lon <= 22) return { name: 'Ionian Sea', code: '', isWater: true };
  if (lat >= 38 && lat <= 41 && lon >= 10 && lon <= 15) return { name: 'Tyrrhenian Sea', code: '', isWater: true };
  if (lat >= 42 && lat <= 44 && lon >= 7 && lon <= 10) return { name: 'Ligurian Sea', code: '', isWater: true };
  if (lat >= 60 && lat <= 66 && lon >= 19 && lon <= 31) return { name: 'Gulf of Bothnia', code: '', isWater: true };
  if (lat >= 59 && lat <= 61 && lon >= 22 && lon <= 31) return { name: 'Gulf of Finland', code: '', isWater: true };
  if (lat >= 51 && lat <= 55 && lon >= -6 && lon <= -3) return { name: 'Irish Sea', code: '', isWater: true };
  if (lat >= 49 && lat <= 51 && lon >= -6 && lon <= 2) return { name: 'English Channel', code: '', isWater: true };
  if (lat >= 48 && lat <= 52 && lon >= -11 && lon <= -4) return { name: 'Celtic Sea', code: '', isWater: true };
  if (lat >= 43 && lat <= 48 && lon >= -10 && lon <= -1) return { name: 'Bay of Biscay', code: '', isWater: true };
  if (lat >= 46 && lat <= 51 && lon >= -70 && lon <= -57) return { name: 'Gulf of St. Lawrence', code: '', isWater: true };
  if (lat >= 51 && lat <= 64 && lon >= -95 && lon <= -78) return { name: 'Hudson Bay', code: '', isWater: true };
  if (lat >= 69 && lat <= 76 && lon >= -142 && lon <= -124) return { name: 'Beaufort Sea', code: '', isWater: true };
  if (lat >= 66 && lat <= 72 && lon >= -180 && lon <= -157) return { name: 'Chukchi Sea', code: '', isWater: true };
  if (lat >= 70 && lat <= 77 && lon >= 140 && lon <= 180) return { name: 'East Siberian Sea', code: '', isWater: true };
  if (lat >= 72 && lat <= 81 && lon >= 100 && lon <= 140) return { name: 'Laptev Sea', code: '', isWater: true };
  if (lat >= 69 && lat <= 81 && lon >= 55 && lon <= 100) return { name: 'Kara Sea', code: '', isWater: true };
  if (lat >= 70 && lat <= 82 && lon >= 16 && lon <= 55) return { name: 'Barents Sea', code: '', isWater: true };
  if (lat >= 62 && lat <= 72 && lon >= -5 && lon <= 16) return { name: 'Norwegian Sea', code: '', isWater: true };
  if (lat >= 70 && lat <= 82 && lon >= -20 && lon <= -5) return { name: 'Greenland Sea', code: '', isWater: true };
  if (lat >= 54 && lat <= 66 && lon >= -61 && lon <= -50) return { name: 'Labrador Sea', code: '', isWater: true };
  if (lat >= 60 && lat <= 70 && lon >= -70 && lon <= -50) return { name: 'Davis Strait', code: '', isWater: true };
  if (lat >= 70 && lat <= 78 && lon >= -80 && lon <= -60) return { name: 'Baffin Bay', code: '', isWater: true };

  // Major oceans
  if (lat >= 0 && lat <= 66 && lon >= -180 && lon <= -100) return { name: 'Pacific Ocean', code: '', isWater: true };
  if (lat >= -66 && lat <= 0 && lon >= -180 && lon <= -70) return { name: 'Pacific Ocean', code: '', isWater: true };
  if (lat >= 0 && lat <= 66 && lon >= 100 && lon <= 180) return { name: 'Pacific Ocean', code: '', isWater: true };
  if (lat >= -66 && lat <= 0 && lon >= 140 && lon <= 180) return { name: 'Pacific Ocean', code: '', isWater: true };
  if (lat >= 0 && lat <= 66 && lon >= -80 && lon <= 0) return { name: 'Atlantic Ocean', code: '', isWater: true };
  if (lat >= -66 && lat <= 0 && lon >= -50 && lon <= 20) return { name: 'Atlantic Ocean', code: '', isWater: true };
  if (lat >= -30 && lat <= 30 && lon >= -50 && lon <= -20) return { name: 'Atlantic Ocean', code: '', isWater: true };
  if (lat >= -66 && lat <= 30 && lon >= 20 && lon <= 147) return { name: 'Indian Ocean', code: '', isWater: true };
  if (lat >= 66 && lat <= 90) return { name: 'Arctic Ocean', code: '', isWater: true };
  if (lat <= -60) return { name: 'Southern Ocean', code: '', isWater: true };

  return null;
}

/**
 * Creates a basic location display with country estimation based on coordinates
 */
export function createLocationWithCountryFallback(
  lat: number,
  lon: number,
  isLocationIQ404: boolean = false
): LocationDisplay & { isWater?: boolean } {
  const countryInfo = estimateCountryFromCoords(lat, lon);

  const shouldShowWater = isLocationIQ404 && countryInfo?.isWater;

  const primary = shouldShowWater && countryInfo?.name
    ? countryInfo.name
    : '';

  const secondary = shouldShowWater || countryInfo?.isWater
    ? undefined
    : countryInfo?.name;

  return {
    primary,
    secondary,
    countryCode: countryInfo?.code || undefined,
    isWater: shouldShowWater || false
  };
}
