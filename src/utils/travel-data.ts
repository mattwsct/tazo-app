// === 🌍 TRAVEL DATA FOR CHAT COMMANDS ===

// Data is split to src/data/travel-data-content.ts to keep this file small
import { GLOBAL, TRAVEL_DATA as TRAVEL_DATA_RAW } from '../data/travel-data-content';

export interface TravelPhrase {
  lang: string;
  text: string;
  roman?: string;
  meaning: string;
}

export interface EmergencyInfo {
  phone: string; // Emergency phone number (e.g., "112", "911", "000")
  police?: string; // Police-specific number if different
  ambulance?: string; // Ambulance-specific number if different
  fire?: string; // Fire-specific number if different
  australianEmbassy?: string; // Australian embassy contact (for Australian travelers)
  notes?: string[]; // Additional emergency information (injuries, theft, medical, etc.)
}

export interface TravelData {
  foods: string[];
  phrases: TravelPhrase[];
  culturalTips?: string[];
  flirt?: string[]; // Flirting phrases, compliments, and suggestions
  sex?: string[]; // Vulgar/sexually suggestive phrases (for humor in drinking environments)
  insults?: string[]; // Local insults and vulgar language
  emergencyInfo?: EmergencyInfo;
  currency?: {
    name: string; // Currency name (e.g., "Yen", "Euro")
    symbol: string; // Currency symbol (e.g., "¥", "€", "$")
    code: string; // ISO currency code (e.g., "JPY", "EUR", "USD")
  };
  facts?: string[]; // Interesting facts about the country
}

// Cast to typed record to allow string indexing
const TRAVEL_DATA = TRAVEL_DATA_RAW as Record<string, TravelData>;

/**
 * Gets travel data for a country code, falling back to global data
 * Returns { data, isCountrySpecific } to indicate if country-specific data exists
 */
export function getTravelData(countryCode: string | null | undefined): TravelData & { isCountrySpecific: boolean } {
  if (!countryCode) return { ...GLOBAL, isCountrySpecific: false };
  const normalized = countryCode.toUpperCase();
  const data = TRAVEL_DATA[normalized];
  if (data) {
    return { ...data, isCountrySpecific: true };
  }
  return { ...GLOBAL, isCountrySpecific: false };
}

// Country code to name mapping (subset for available countries)
const COUNTRY_NAMES: Record<string, string> = {
  JP: "Japan", VN: "Vietnam", ID: "Indonesia", AU: "Australia", TH: "Thailand",
  KR: "South Korea", PH: "Philippines", SG: "Singapore", MY: "Malaysia", TW: "Taiwan",
  IN: "India", CN: "China", FR: "France", ES: "Spain", IT: "Italy", DE: "Germany",
  GB: "United Kingdom", US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil", TR: "Turkey",
  NZ: "New Zealand", PT: "Portugal", NL: "Netherlands", GR: "Greece", ZA: "South Africa"
};

/**
 * Gets all available country codes and names
 */
export function getAvailableCountries(): Array<{ code: string; name: string }> {
  return Object.keys(TRAVEL_DATA)
    .map(code => ({
      code,
      name: COUNTRY_NAMES[code] || code
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
