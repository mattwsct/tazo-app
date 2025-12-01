import { 
  checkRateLimit
} from './rate-limiting';
import { type LocationData } from './location-utils';
import { ApiLogger } from '@/lib/logger';
import { 
  isValidApiKey
} from './fallback-utils';
import { 
  recordApiSuccess, 
  recordApiFailure, 
  canUseApi 
} from './api-health';





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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  sunriseSunset?: SunriseSunsetData | null;
}

export interface SunriseSunsetData {
  sunrise: string; // HH:MM:SS format
  sunset: string;  // HH:MM:SS format
  dayLength: string; // HH:MM:SS format
}

// === 📍 LOCATION API (LocationIQ) ===

/**
 * Fetches location name from coordinates using LocationIQ API
 * Optimized for English street names globally (including Japan)
 * Includes caching to reduce API calls and respect daily limits
 */
export interface LocationIQResult {
  location: LocationData | null;
  was404: boolean; // True if LocationIQ returned 404 (no address found - likely on water)
}

export async function fetchLocationFromLocationIQ(
  lat: number, 
  lon: number, 
  apiKey: string
): Promise<LocationIQResult> {
  // Check API health before attempting call
  if (!canUseApi('locationiq')) {
    ApiLogger.warn('locationiq', 'API is currently unavailable, using fallback');
    return { location: null, was404: false }; // Will trigger fallback in calling code
  }

  if (!isValidApiKey(apiKey)) {
    const error = 'Invalid or missing API key';
    ApiLogger.warn('locationiq', error);
    recordApiFailure('locationiq', error);
    return { location: null, was404: false };
  }

  // Check rate limits (per-second only)
  if (!checkRateLimit('locationiq')) {
    const error = 'Rate limit exceeded';
    ApiLogger.warn('locationiq', error);
    recordApiFailure('locationiq', error, true);
    return { location: null, was404: false };
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
      let error: string;
      let isRateLimited = false;
      
      if (response.status === 429) {
        error = 'Rate limit exceeded';
        isRateLimited = true;
        ApiLogger.info('locationiq', 'Rate limit exceeded - fallback will be used', { 
          status: response.status,
          message: 'Rate limit exceeded - fallback will be used'
        });
      } else if (response.status === 402) {
        error = 'Daily API limit reached';
        ApiLogger.warn('locationiq', 'Daily API limit reached', { 
          message: 'LocationIQ daily limit exceeded. Consider upgrading plan or wait until tomorrow.'
        });
      } else if (response.status === 401) {
        error = 'Invalid API key';
        ApiLogger.warn('locationiq', 'Invalid API key');
      } else if (response.status === 404) {
        error = 'Location not found (likely at sea or remote area)';
        ApiLogger.info('locationiq', 'No reverse geocode available - using coordinate fallback', { 
          status: 404,
          lat,
          lon
        });
        recordApiFailure('locationiq', error, isRateLimited);
        return { location: null, was404: true }; // 404 means likely on water
      } else {
        error = `HTTP ${response.status}: ${response.statusText}`;
        ApiLogger.error('locationiq', error);
      }
      
      recordApiFailure('locationiq', error, isRateLimited);
      return { location: null, was404: false }; // Other errors are not 404
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
        quarter: data.address.quarter, // Extract quarter from address
        province: data.address.province,
        region: data.address.region,
        county: data.address.county,
        house_number: data.address.house_number,
        road: data.address.road,
        postcode: data.address.postcode,
      };
      
      ApiLogger.info('locationiq', 'Location data received', result);
      
      // Record successful API call
      recordApiSuccess('locationiq');
      
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
        return { location: null, was404: false };
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
        timezone: data.address.timezone,
        fullAddress: data.address
      });
      
      return { location: result, was404: false };
    }
    
    throw new Error('No address data in response');
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    ApiLogger.error('locationiq', 'Failed to fetch location', error);
    recordApiFailure('locationiq', errorMessage);
    return { location: null, was404: false };
  }
}


// === 🌤️ WEATHER API (OpenWeatherMap) ===

/**
 * Fetches weather, timezone, and sunrise/sunset data from OpenWeatherMap API
 * Includes sunrise/sunset times for accurate day/night detection
 */
export async function fetchWeatherAndTimezoneFromOpenWeatherMap(
  lat: number, 
  lon: number,
  apiKey: string
): Promise<WeatherTimezoneResponse | null> {
  // Check API health before attempting call
  if (!canUseApi('openweathermap')) {
    ApiLogger.warn('openweathermap', 'API is currently unavailable, using fallback');
    return null; // Will trigger fallback in calling code
  }

  if (!isValidApiKey(apiKey)) {
    const error = 'Invalid or missing API key';
    ApiLogger.warn('openweathermap', error);
    recordApiFailure('openweathermap', error);
    return null;
  }

  if (!checkRateLimit('openweathermap')) {
    const error = 'Rate limit exceeded';
    ApiLogger.warn('openweathermap', error);
    recordApiFailure('openweathermap', error, true);
    return null;
  }
  
  try {
    ApiLogger.info('openweathermap', 'Fetching weather, timezone, and sunrise/sunset data', { lat, lon });
    
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    
    const response = await fetchWithRetry(url);
    
    if (!response.ok) {
      let error: string;
      let isRateLimited = false;
      
      if (response.status === 429) {
        error = 'Rate limit exceeded';
        isRateLimited = true;
      } else if (response.status === 401) {
        error = 'Invalid API key';
      } else if (response.status === 404) {
        error = 'Location not found';
      } else {
        error = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      recordApiFailure('openweathermap', error, isRateLimited);
      throw new Error(error);
    }
    
    const data = await response.json();
    
    if (data.cod !== 200) {
      const error = `OpenWeatherMap Error: ${data.message || 'Unknown error'}`;
      recordApiFailure('openweathermap', error);
      throw new Error(error);
    }
    
    let weather: WeatherData | null = null;
    let timezone: string | null = null;
    let sunriseSunset: SunriseSunsetData | null = null;
    
    // Extract weather data
    if (data.main && typeof data.main.temp === 'number' && data.weather && data.weather[0]) {
      weather = {
        temp: Math.round(data.main.temp),
        desc: data.weather[0].description || 'unknown',
      };
      
      ApiLogger.info('openweathermap', 'Weather data received', weather);
    }
    
    // Extract timezone data
    if (data.timezone && typeof data.timezone === 'number') {
      // Convert timezone offset to IANA timezone string
      const offsetHours = Math.round(data.timezone / 3600);
      
      // Map timezone offsets to IANA timezone names
      // Note: Offset includes DST, so same offset can map to different timezones
      // For US locations, we need to use coordinate/state info for accuracy
      const timezoneMap: Record<number, string> = {
        9: 'Asia/Tokyo',
        8: 'Asia/Shanghai',
        7: 'Asia/Bangkok',
        6: 'Asia/Dhaka',
        5: 'Asia/Karachi',
        4: 'Asia/Dubai',
        3: 'Europe/Moscow',
        2: 'Europe/Athens',
        1: 'Europe/Paris',
        0: 'UTC',
        [-1]: 'Atlantic/Azores',
        [-2]: 'Atlantic/South_Georgia',
        [-3]: 'America/Sao_Paulo',
        [-4]: 'America/New_York',
        [-5]: 'America/Chicago', // CST/CDT: -6/-5
        [-6]: 'America/Chicago', // Most common: Central Time
        [-7]: 'America/Denver', // MST/MDT: -7/-6
        [-8]: 'America/Los_Angeles', // PST/PDT: -8/-7
        [-9]: 'Pacific/Gambier',
        [-10]: 'Pacific/Honolulu',
        [-11]: 'Pacific/Midway',
        [-12]: 'Pacific/Baker'
      };
      
      // Try to get timezone from map, with fallback
      timezone = timezoneMap[offsetHours] || timezoneMap[Math.floor(offsetHours)] || 'UTC';
      
      // For US locations, improve accuracy based on coordinates
      // Texas (Galveston) should be America/Chicago (Central Time)
      // This is a simplified check - could be improved with full state/coordinate mapping
      if (lat >= 25 && lat <= 37 && lon >= -106 && lon <= -93) {
        // Texas region - Central Time
        if (offsetHours === -5 || offsetHours === -6) {
          timezone = 'America/Chicago';
        }
      } else if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
        // General US region - refine based on common offsets
        if (offsetHours === -5 && (lat < 40 || lon < -100)) {
          timezone = 'America/Chicago'; // Central Time (includes DST)
        } else if (offsetHours === -6 && (lat < 40 || lon < -100)) {
          timezone = 'America/Chicago'; // Central Time (no DST)
        } else if (offsetHours === -4 && (lat >= 38 && lon >= -85)) {
          timezone = 'America/New_York'; // Eastern Time
        } else if (offsetHours === -7 && (lat >= 35 && lon >= -124 && lon <= -102)) {
          timezone = 'America/Denver'; // Mountain Time
        } else if (offsetHours === -8 && (lat >= 32 && lon >= -124 && lon <= -102)) {
          timezone = 'America/Los_Angeles'; // Pacific Time
        }
      }
      
      ApiLogger.info('openweathermap', 'Timezone data received', { 
        timezone, 
        offsetHours, 
        rawOffsetSeconds: data.timezone,
        coordinates: { lat, lon }
      });
    }
    
    // Extract sunrise/sunset data
    if (data.sys && data.sys.sunrise && data.sys.sunset) {
      const sunrise = new Date(data.sys.sunrise * 1000);
      const sunset = new Date(data.sys.sunset * 1000);
      
      sunriseSunset = {
        sunrise: sunrise.toISOString(),
        sunset: sunset.toISOString(),
        dayLength: formatDuration(sunset.getTime() - sunrise.getTime())
      };
      
      ApiLogger.info('openweathermap', 'Sunrise/sunset data received', sunriseSunset);
    }
    
    // Record successful API call
    recordApiSuccess('openweathermap');
    
    const result = { weather, timezone, sunriseSunset };
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    ApiLogger.error('openweathermap', 'Failed to fetch weather/timezone/sunrise-sunset', error);
    recordApiFailure('openweathermap', errorMessage);
    return null;
  }
}

// Helper function to format duration in HH:MM:SS format
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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