import { type LocationData, stripTrailingNumbers } from './location-utils';
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

// === 🌤️ WEATHER TYPES ===
export interface WeatherData {
  temp: number; // "feels like" temperature (more accurate for IRL streaming)
  desc: string;
  windKmh?: number;
  humidity?: number;
  visibility?: number | null;
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

  // Rate limiting is checked in overlay/page.tsx before calling this function
  // Don't check again here to avoid double-checking and race conditions

  const isDev = process.env.NODE_ENV !== 'production';

  try {
    if (isDev) {
      ApiLogger.info('locationiq', 'Fetching location data', { lat, lon });
    }
    
    // Add cache busting timestamp to prevent browser caching
    const timestamp = Date.now();
    const url = `https://us1.locationiq.com/v1/reverse.php?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en&_t=${timestamp}`;
    const response = await fetchWithRetry(url, {
      headers: { 'Accept-Language': 'en' },
    });
    
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
        if (isDev) {
          ApiLogger.info('locationiq', 'No reverse geocode available - using coordinate fallback', { status: 404 });
        }
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
      // NOTE: Do NOT use suburb as fallback - it's a neighborhood field, not a city field
      // This ensures City mode shows actual city names (e.g., "Austin") not neighborhoods (e.g., "Downtown")
      const city = data.address.city || 
                  data.address.municipality ||  // Municipality is often the actual city
                  data.address.town;            // Town is usually a proper city
                  // Suburb is NOT used here - it's stored separately and handled by precision logic
      
      // State/province/region level - do NOT include county here as it's a separate administrative level
      // County is stored separately and handled by precision logic
      const state = data.address.province ||  // Japanese prefectures are in 'province' field
                   data.address.state || 
                   data.address.region;
      
      // Normalize location names to English and strip trailing numbers (e.g. "Honcho 6" -> "Honcho")
      const normalizeToEnglish = (name: string | undefined): string | undefined => (name ? name.trim() : name);
      const clean = (name: string | undefined): string | undefined => {
        if (!name) return name;
        return stripTrailingNumbers(normalizeToEnglish(name) || name) || name;
      };
      
      const result: LocationData = {
        city: clean(city) || city,
        state: clean(state) || state,
        country: clean(data.address.country) || data.address.country,
        countryCode: data.address.country_code ? data.address.country_code.toLowerCase() : '',
        timezone: data.address.timezone,
        town: clean(data.address.town) || data.address.town,
        municipality: clean(data.address.municipality) || data.address.municipality,
        suburb: clean(data.address.suburb) || data.address.suburb,
        neighbourhood: clean(data.address.neighbourhood) || data.address.neighbourhood,
        quarter: clean(data.address.quarter) || data.address.quarter,
        province: clean(data.address.province) || data.address.province,
        region: clean(data.address.region) || data.address.region,
        county: clean(data.address.county) || data.address.county,
        house_number: data.address.house_number,
        road: data.address.road,
        postcode: data.address.postcode,
      };
      
      if (isDev) {
        ApiLogger.info('locationiq', 'Location data received', result);
      }
      
      // Record successful API call
      recordApiSuccess('locationiq');
      
      // Validate the result before returning
      if (!result.city && !result.state && !result.country) {
        ApiLogger.warn('locationiq', 'LocationIQ returned incomplete result - missing city, state, and country', {
          availableFields: isDev ? { neighbourhood: result.neighbourhood, suburb: result.suburb, town: result.town, municipality: result.municipality } : {},
        });
        return { location: null, was404: false };
      }
      
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

  // Rate limiting is checked in overlay/page.tsx before calling this function
  // Don't check again here to avoid double-checking and race conditions
  
  try {
    if (process.env.NODE_ENV !== 'production') {
      ApiLogger.info('openweathermap', 'Fetching weather, timezone, and sunrise/sunset data', { lat, lon });
    }
    
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
    // Use "feels like" temperature as it's more accurate for IRL streaming (accounts for wind, humidity, etc.)
    // Extract wind data - use sustained wind speed (wind.speed), not gusts (wind.gust)
    // wind.speed is in m/s, convert to km/h
    const windKmh = data.wind?.speed ? Math.round(data.wind.speed * 3.6) : undefined;
    
    if (data.main && typeof data.main.feels_like === 'number' && data.weather && data.weather[0]) {
      weather = {
        temp: Math.round(data.main.feels_like), // Use "feels like" temperature
        desc: data.weather[0].description || 'unknown',
        windKmh: windKmh,
        humidity: data.main.humidity || undefined,
        visibility: data.visibility ? (data.visibility / 1000) : null,
      };
      
      ApiLogger.info('openweathermap', 'Weather data received', weather);
    } else if (data.main && typeof data.main.temp === 'number' && data.weather && data.weather[0]) {
      // Fallback to regular temp if feels_like is not available
      weather = {
        temp: Math.round(data.main.temp),
        desc: data.weather[0].description || 'unknown',
        windKmh: windKmh,
        humidity: data.main.humidity || undefined,
        visibility: data.visibility ? (data.visibility / 1000) : null,
      };
      
      ApiLogger.info('openweathermap', 'Weather data received (using regular temp as feels_like unavailable)', weather);
    }
    
    // Extract timezone data
    // NOTE: OpenWeatherMap only provides a numeric offset (seconds), not an IANA timezone name
    // LocationIQ provides the actual IANA timezone name and is preferred
    // This is a simplified fallback mapping - LocationIQ should handle most cases accurately
    if (data.timezone && typeof data.timezone === 'number') {
      // Convert timezone offset to hours
      const offsetHours = Math.round(data.timezone / 3600);
      
      // Simple offset-to-timezone mapping (fallback only)
      // This is approximate - same offset can map to different timezones (e.g., -4 could be Eastern or Central with DST)
      // LocationIQ provides accurate IANA timezone names and should be used when available
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
        [-4]: 'America/New_York', // Eastern Time (EDT) - approximate, LocationIQ preferred
        [-5]: 'America/Chicago', // Default fallback - will be refined by coordinates for US
        [-6]: 'America/Chicago', // Central Time (CST) - approximate, LocationIQ preferred
        [-7]: 'America/Denver', // Mountain Time - approximate, LocationIQ preferred
        [-8]: 'America/Los_Angeles', // Pacific Time - approximate, LocationIQ preferred
        [-9]: 'Pacific/Gambier',
        [-10]: 'Pacific/Honolulu',
        [-11]: 'Pacific/Midway',
        [-12]: 'Pacific/Baker'
      };
      
      // Use simple offset mapping as base
      timezone = timezoneMap[offsetHours] || timezoneMap[Math.floor(offsetHours)] || 'UTC';
      
      // For US locations, refine timezone based on coordinates (when LocationIQ doesn't provide timezone)
      // This handles cases where same offset maps to different US timezones
      if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
        // US region - use coordinates to determine correct timezone
        if (offsetHours === -5) {
          // -5 offset can be Eastern Time (EST) or Central Time (CDT)
          // Eastern Time: roughly east of -87° longitude (includes Florida, Georgia, Carolinas, etc.)
          if (lon >= -87) {
            timezone = 'America/New_York'; // Eastern Time (EST)
          } else {
            timezone = 'America/Chicago'; // Central Time (CDT)
          }
        } else if (offsetHours === -4) {
          // -4 offset is Eastern Time (EDT) - covers entire Eastern US
          if (lon >= -87) {
            timezone = 'America/New_York'; // Eastern Time (EDT)
          }
        } else if (offsetHours === -6) {
          // -6 offset is Central Time (CST) - covers central US
          if (lon >= -106 && lon <= -85) {
            timezone = 'America/Chicago'; // Central Time (CST)
          }
        } else if (offsetHours === -7) {
          // -7 offset is Mountain Time (MDT) - covers mountain states
          if (lon >= -124 && lon <= -102) {
          timezone = 'America/Denver'; // Mountain Time
          }
        } else if (offsetHours === -8) {
          // -8 offset is Pacific Time (PST) - covers west coast
          if (lon >= -124 && lon <= -102) {
          timezone = 'America/Los_Angeles'; // Pacific Time
          }
        }
      }
      
      if (process.env.NODE_ENV !== 'production') {
        ApiLogger.info('openweathermap', 'Timezone data received (fallback - LocationIQ preferred)', { 
          timezone, 
          offsetHours, 
          rawOffsetSeconds: data.timezone,
          coordinates: { lat, lon },
          note: 'OpenWeatherMap provides offset only - LocationIQ provides accurate IANA timezone name'
        });
      }
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

/**
 * Converts OpenWeatherMap timezone offset (seconds) to IANA timezone string.
 * Used when we have raw OWM response without LocationIQ.
 */
export function getTimezoneFromOwmOffset(offsetSeconds: number, lat?: number, lon?: number): string {
  const offsetHours = Math.round(offsetSeconds / 3600);
  const timezoneMap: Record<number, string> = {
    9: 'Asia/Tokyo', 8: 'Asia/Shanghai', 7: 'Asia/Bangkok', 6: 'Asia/Dhaka', 5: 'Asia/Karachi',
    4: 'Asia/Dubai', 3: 'Europe/Moscow', 2: 'Europe/Athens', 1: 'Europe/Paris', 0: 'UTC',
    [-1]: 'Atlantic/Azores', [-2]: 'Atlantic/South_Georgia', [-3]: 'America/Sao_Paulo',
    [-4]: 'America/New_York', [-5]: 'America/Chicago', [-6]: 'America/Chicago', [-7]: 'America/Denver',
    [-8]: 'America/Los_Angeles', [-9]: 'Pacific/Gambier', [-10]: 'Pacific/Honolulu',
    [-11]: 'Pacific/Midway', [-12]: 'Pacific/Baker',
  };
  let tz = timezoneMap[offsetHours] || timezoneMap[Math.floor(offsetHours)] || 'UTC';
  if (lat != null && lon != null && lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    if (offsetHours === -5 && lon >= -87) tz = 'America/New_York';
    else if (offsetHours === -4 && lon >= -87) tz = 'America/New_York';
    else if (offsetHours === -6 && lon >= -106 && lon <= -85) tz = 'America/Chicago';
    else if (offsetHours === -7 && lon >= -124 && lon <= -102) tz = 'America/Denver';
    else if (offsetHours === -8 && lon >= -124 && lon <= -102) tz = 'America/Los_Angeles';
  }
  return tz;
}

// Helper function to format duration in HH:MM:SS format
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
} 