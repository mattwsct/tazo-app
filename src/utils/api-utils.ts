import { 
  checkRateLimit, 
  type LocationData 
} from './overlay-utils';
import { ApiLogger } from '@/lib/logger';

// === 🗄️ SIMPLE CACHE SYSTEM ===
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  clear(): void {
    this.cache.clear();
  }
}

const apiCache = new SimpleCache();

// Clear cache on page load to ensure fresh data
if (typeof window !== 'undefined') {
  // Clear cache when page loads/refreshes
  apiCache.clear();
}

// === ⏱️ API CONFIGURATION ===
const API_CONFIG = {
  TIMEOUT: 10000, // 10 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000, // 1 second base delay
  MAX_RETRY_DELAY: 10000, // 10 seconds max delay
} as const;

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
  icon: string;
  desc: string;
}

export interface WeatherTimezoneResponse {
  weather: WeatherData | null;
  timezone: string | null;
  sunrise?: string;
  sunset?: string;
}

// === 📍 LOCATION API (LocationIQ) ===

/**
 * Fetches location name from coordinates using LocationIQ API
 * Optimized for English street names globally (including Japan)
 */
export async function fetchLocationFromLocationIQ(
  lat: number, 
  lon: number, 
  apiKey: string
): Promise<LocationData | null> {
  // Check cache first (30 minute cache for location data)
  // Use more precise cache key (6 decimal places instead of 3)
  const cacheKey = `location_${lat.toFixed(6)}_${lon.toFixed(6)}`;
  const cached = apiCache.get<LocationData>(cacheKey);
  if (cached) {
    ApiLogger.info('locationiq', 'Using cached location data', { lat, lon });
    return cached;
  }

  if (!apiKey || !checkRateLimit('locationiq')) {
    ApiLogger.warn('locationiq', 'API call skipped', { 
      hasKey: !!apiKey, 
      rateLimitOk: checkRateLimit('locationiq') 
    });
    return null;
  }

  try {
    ApiLogger.info('locationiq', 'Fetching location data', { lat, lon });
    
    // Add cache busting timestamp to prevent browser caching
    const timestamp = Date.now();
    const response = await fetchWithRetry(
      `https://us1.locationiq.com/v1/reverse.php?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en&_t=${timestamp}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`LocationIQ Error: ${data.error}`);
    }
    
    if (data.address) {
      // Parse address components with fallbacks
      const city = data.address.city || 
                  data.address.town || 
                  data.address.municipality ||
                  data.address.suburb;  // Use suburb as fallback for city-level
      
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
        displayName: data.display_name,
      };
      
      ApiLogger.info('locationiq', 'Location data received', result);
      
      // Cache the result for 30 minutes
      apiCache.set(cacheKey, result, 30 * 60 * 1000);
      
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
  // Check cache first (5 minute cache for weather data)
  const cacheKey = `weather_${lat.toFixed(3)}_${lon.toFixed(3)}`;
  const cached = apiCache.get<WeatherTimezoneResponse>(cacheKey);
  if (cached) {
    ApiLogger.info('openmeteo', 'Using cached weather data', { lat, lon });
    return cached;
  }

  if (!checkRateLimit('openmeteo')) {
    ApiLogger.warn('openmeteo', 'Rate limit exceeded, skipping API call');
    return null;
  }
  
  try {
    ApiLogger.info('openmeteo', 'Fetching weather and timezone data', { lat, lon });
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&temperature_unit=celsius&timezone=auto&forecast_days=1`;
    
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
    let sunrise: string | undefined;
    let sunset: string | undefined;
    
    // Extract weather data
    if (data.current && 
        typeof data.current.temperature_2m === 'number' && 
        typeof data.current.weather_code === 'number') {
      
      weather = {
        temp: Math.round(data.current.temperature_2m),
        icon: data.current.weather_code.toString(), // WMO code for day/night logic
        desc: getWeatherDescription(data.current.weather_code), // Proper description
      };
      
      ApiLogger.info('openmeteo', 'Weather data received', weather);
    }
    
    // Extract timezone data
    if (data.timezone && typeof data.timezone === 'string') {
      timezone = data.timezone;
      ApiLogger.info('openmeteo', 'Timezone data received', { timezone });
    }
    
    // Extract sunrise/sunset data
    if (data.daily && data.daily.sunrise && data.daily.sunset) {
      sunrise = data.daily.sunrise[0]; // First day's sunrise
      sunset = data.daily.sunset[0];   // First day's sunset
      ApiLogger.info('openmeteo', 'Sunrise/sunset data received', { sunrise, sunset });
    }
    
    const result = { weather, timezone, sunrise, sunset };
    
    // Cache the result for 5 minutes
    apiCache.set(cacheKey, result, 5 * 60 * 1000);
    
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