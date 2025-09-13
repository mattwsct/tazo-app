import { 
  checkRateLimit
} from './rate-limiting';
import { type LocationData } from './location-utils';
import { ApiLogger } from '@/lib/logger';





// === ⏱️ API CONFIGURATION ===
const API_CONFIG = {
  TIMEOUT: 10000, // 10 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000, // 1 second base delay
  MAX_RETRY_DELAY: 10000, // 10 seconds max delay
} as const;

// === 🧠 CACHING REMOVED ===
// Caching system removed to prevent stale data issues

// === 🔄 RETRY UTILITY ===
async function fetchWithRetry(
  url: string, 
  options: RequestInit = {}, 
  retries: number = API_CONFIG.RETRY_ATTEMPTS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (retries > 0 && (error instanceof Error && error.name === 'AbortError')) {
      // Calculate exponential backoff delay
      const attempt = API_CONFIG.RETRY_ATTEMPTS - retries + 1;
      const backoffDelay = Math.min(
        API_CONFIG.RETRY_DELAY * Math.pow(2, attempt - 1),
        API_CONFIG.MAX_RETRY_DELAY
      );
      
      ApiLogger.warn('fetch', `Request timeout, retrying in ${backoffDelay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      return fetchWithRetry(url, options, retries - 1);
    }
    
    throw error;
  }
}

// === 🌤️ WEATHER UTILITIES ===

/**
 * Maps WMO Weather Code to human-readable description
 */
function getWeatherDescription(wmoCode: number): string {
  const descMap: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'light freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snow fall',
    73: 'moderate snow fall',
    75: 'heavy snow fall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail',
    99: 'thunderstorm with heavy hail',
  };
  return descMap[wmoCode] || 'unknown';
}

// === 🌤️ WEATHER TYPES ===
export interface WeatherData {
  temp: number;
  desc: string;
}

export interface WeatherTimezoneResponse {
  weather: WeatherData | null;
  timezone: string | null;
}

// === 📍 LOCATION API (LocationIQ) ===

/**
 * Fetches location name from coordinates using LocationIQ API
 * Optimized for English street names globally (including Japan)
 * Includes caching to reduce API calls and respect daily limits
 */
export async function fetchLocationFromLocationIQ(
  lat: number, 
  lon: number, 
  apiKey: string
): Promise<LocationData | null> {
  if (!apiKey) {
    ApiLogger.warn('locationiq', 'API key not provided');
    return null;
  }

  // No caching - always fetch fresh data



  // Check rate limits (per-second only)
  if (!checkRateLimit('locationiq')) {
    ApiLogger.warn('locationiq', 'Rate limit exceeded, skipping API call');
    return null;
  }

  try {
    ApiLogger.info('locationiq', 'Fetching location data', { 
      lat, 
      lon
    });
    
    // Add cache busting timestamp to prevent browser caching
    const timestamp = Date.now();
    const response = await fetchWithRetry(
      `https://us1.locationiq.com/v1/reverse.php?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en&_t=${timestamp}`
    );
    
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limit exceeded - this is expected and handled by fallback
        ApiLogger.info('locationiq', 'Rate limit exceeded - fallback will be used', { 
          status: response.status,
          message: 'Rate limit exceeded - Mapbox fallback will be used'
        });
        return null; // Return null instead of throwing error
      } else if (response.status === 402) {
        ApiLogger.warn('locationiq', 'Daily API limit reached', { 
          message: 'LocationIQ daily limit exceeded. Consider upgrading plan or wait until tomorrow.'
        });
        return null;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`LocationIQ Error: ${data.error}`);
    }
    
    if (data.address) {
      // Parse address components with better city prioritization
      // Try to get the most recognizable city name, not just the smallest administrative unit
      const city = data.address.city || 
                  data.address.municipality ||  // Municipality is often the actual city
                  data.address.town ||          // Town is usually a proper city
                  data.address.suburb;          // Suburb as last resort (often just neighborhood names)
      
      const state = data.address.province ||  // Japanese prefectures are in 'province' field
                   data.address.state || 
                   data.address.region || 
                   data.address.county;
      
      const result: LocationData = {
        city: city,
        state: state,
        country: data.address.country,
        countryCode: data.address.country_code ? data.address.country_code.toLowerCase() : '',
        timezone: data.address.timezone,
        // Store the raw address components for better city detection
        town: data.address.town,
        municipality: data.address.municipality,
        suburb: data.address.suburb,
        neighbourhood: data.address.neighbourhood, // British spelling from LocationIQ
        province: data.address.province,
        region: data.address.region,
        county: data.address.county,
        house_number: data.address.house_number,
        road: data.address.road,
        postcode: data.address.postcode,
      };
      
      ApiLogger.info('locationiq', 'Location data received', result);
      
      // Validate the result before returning
      if (!result.city && !result.state && !result.country) {
        ApiLogger.warn('locationiq', 'LocationIQ returned incomplete result - missing city, state, and country', {
          availableFields: {
            neighbourhood: result.neighbourhood,
            suburb: result.suburb,
            town: result.town,
            municipality: result.municipality
          }
        });
        return null;
      }
      
      // Debug: Log the raw API response to see what fields are actually available
      ApiLogger.info('locationiq', 'Raw API response address fields', {
        house_number: data.address.house_number,
        road: data.address.road,
        neighbourhood: data.address.neighbourhood,
        suburb: data.address.suburb,
        town: data.address.town,
        municipality: data.address.municipality,
        city: data.address.city,
        county: data.address.county,
        state: data.address.state,
        province: data.address.province,
        region: data.address.region,
        postcode: data.address.postcode,
        country: data.address.country,
        fullAddress: data.address
      });
      
      return result;
    }
    
    throw new Error('No address data in response');
    
  } catch (error) {
    ApiLogger.error('locationiq', 'Failed to fetch location', error);
    return null;
  }
}


// === 🌤️ WEATHER API (Open-Meteo) ===

/**
 * Fetches weather and timezone data from Open-Meteo API
 * Free tier with no API key required - combined endpoint for efficiency
 */
export async function fetchWeatherAndTimezoneFromOpenMeteo(
  lat: number, 
  lon: number
): Promise<WeatherTimezoneResponse | null> {
  // No caching - always fetch fresh data

  if (!checkRateLimit('openmeteo')) {
    ApiLogger.warn('openmeteo', 'Rate limit exceeded, skipping API call');
    return null;
  }
  
  try {
    ApiLogger.info('openmeteo', 'Fetching weather and timezone data', { lat, lon });
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto`;
    
    const response = await fetchWithRetry(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Open-Meteo Error: ${data.reason || data.error}`);
    }
    
    let weather: WeatherData | null = null;
    let timezone: string | null = null;
    
    // Extract weather data
    if (data.current && 
        typeof data.current.temperature_2m === 'number' && 
        typeof data.current.weather_code === 'number') {
      
      weather = {
        temp: Math.round(data.current.temperature_2m),
        desc: getWeatherDescription(data.current.weather_code),
      };
      
      ApiLogger.info('openmeteo', 'Weather data received', weather);
    }
    
    // Extract timezone data
    if (data.timezone && typeof data.timezone === 'string') {
      timezone = data.timezone;
      ApiLogger.info('openmeteo', 'Timezone data received', { timezone });
    }
    
    const result = { weather, timezone };
    return result;
    
  } catch (error) {
    ApiLogger.error('openmeteo', 'Failed to fetch weather/timezone', error);
    return null;
  }
} 

// === 🛠️ API HELPER FUNCTIONS ===

/**
 * Creates a consistent error response
 */
export function createErrorResponse(message: string, status: number = 400) {
  return Response.json({ success: false, error: message }, { status });
}

/**
 * Creates a consistent success response
 */
export function createSuccessResponse(data?: Record<string, unknown>) {
  return Response.json({ success: true, ...data });
} 