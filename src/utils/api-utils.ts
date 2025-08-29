import { 
  checkRateLimit, 
  getRemainingDailyCalls,
  getCachedLocation,
  cacheLocation,
  type LocationData 
} from './overlay-utils';
import { ApiLogger } from '@/lib/logger';





// === ⏱️ API CONFIGURATION ===
const API_CONFIG = {
  TIMEOUT: 10000, // 10 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000, // 1 second base delay
  MAX_RETRY_DELAY: 10000, // 10 seconds max delay
} as const;

// === 🧠 SIMPLE IN-MEMORY CACHE (client/runtime scoped) ===
const WEATHER_CACHE_TTL_MS = 60 * 1000; // 60s
type WeatherCacheKey = string; // `${lat.toFixed(3)},${lon.toFixed(3)}`
const weatherCache = new Map<WeatherCacheKey, { timestamp: number; data: WeatherTimezoneResponse | null }>();

function getWeatherCacheKey(lat: number, lon: number): WeatherCacheKey {
  // Round to reduce cache fragmentation while keeping useful precision
  const rLat = lat.toFixed(3);
  const rLon = lon.toFixed(3);
  return `${rLat},${rLon}`;
}

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

  // Check cache first
  const cached = getCachedLocation(lat, lon);
  if (cached) {
    ApiLogger.info('locationiq', 'Using cached location data', { lat, lon });
    return cached;
  }

  // Check rate limits (both per-second and daily)
  if (!checkRateLimit('locationiq')) {
    const remaining = getRemainingDailyCalls('locationiq');
    if (remaining === 0) {
      ApiLogger.warn('locationiq', 'Daily API limit reached', { 
        dailyLimit: 1000,
        message: 'LocationIQ daily limit exceeded. Consider upgrading plan or wait until tomorrow.',
        currentDailyCalls: 1000 - remaining,
        resetTime: new Date(Date.now() + (86400000 - (Date.now() % 86400000))).toISOString()
      });
    } else {
      ApiLogger.warn('locationiq', 'Rate limit exceeded', { 
        remainingDaily: remaining,
        message: 'Too many requests per second. Please wait a moment.',
        currentDailyCalls: 1000 - remaining,
        timeUntilReset: new Date(Date.now() + (86400000 - (Date.now() % 86400000))).toISOString()
      });
    }
    return null;
  }

  try {
    const remaining = getRemainingDailyCalls('locationiq');
    ApiLogger.info('locationiq', 'Fetching location data', { 
      lat, 
      lon, 
      remainingDaily: remaining 
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
          dailyLimit: 1000,
          message: 'LocationIQ daily limit exceeded. Consider upgrading plan or wait until tomorrow.',
          currentDailyCalls: 1000 - remaining,
          resetTime: new Date(Date.now() + (86400000 - (Date.now() % 86400000))).toISOString()
        });
        return null; // Return null for daily limit too
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
        province: data.address.province,
        region: data.address.region,
        county: data.address.county,
      };
      
      // Cache the result to reduce future API calls
      cacheLocation(lat, lon, result);
      
      ApiLogger.info('locationiq', 'Location data received and cached', result);
      
      return result;
    }
    
    throw new Error('No address data in response');
    
  } catch (error) {
    ApiLogger.error('locationiq', 'Failed to fetch location', error);
    return null;
  }
}

// === 🗺️ LOCATION API FALLBACK (Mapbox) ===

/**
 * Fetches location name from coordinates using Mapbox API as fallback
 * Used when LocationIQ hits rate limits or fails
 */
export async function fetchLocationFromMapbox(
  lat: number, 
  lon: number, 
  apiKey: string
): Promise<LocationData | null> {
  if (!apiKey) {
    ApiLogger.warn('mapbox', 'API key not provided');
    return null;
  }

  // Check cache first
  const cached = getCachedLocation(lat, lon);
  if (cached) {
    ApiLogger.info('mapbox', 'Using cached location data', { lat, lon });
    return cached;
  }

  // Check rate limits
  if (!checkRateLimit('mapbox')) {
    ApiLogger.warn('mapbox', 'Rate limit exceeded, skipping API call');
    return null;
  }

  try {
    ApiLogger.info('mapbox', 'Fetching location data (fallback)', { lat, lon });
    
    // Mapbox reverse geocoding API
    const response = await fetchWithRetry(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${apiKey}&types=place,region,country&language=en&limit=1`
    );
    
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limit exceeded - this is expected
        ApiLogger.info('mapbox', 'Rate limit exceeded', { 
          status: response.status,
          message: 'Mapbox rate limit exceeded'
        });
        return null; // Return null instead of throwing error
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Mapbox Error: ${data.error}`);
    }
    
    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const context = feature.context || [];
      
      // Extract location components from Mapbox response
      let city: string | undefined;
      let state: string | undefined;
      let country: string | undefined;
      let countryCode: string | undefined;
      
      // Parse context array for administrative levels
      for (const item of context) {
        if (item.id.startsWith('place')) {
          city = item.text;
        } else if (item.id.startsWith('region')) {
          state = item.text;
        } else if (item.id.startsWith('country')) {
          country = item.text;
          countryCode = item.short_code;
        }
      }
      
      // If no city in context, use the main feature name
      if (!city && feature.place_type.includes('place')) {
        city = feature.text;
      }
      
      // If no state in context, try to extract from feature name
      if (!state && feature.place_type.includes('region')) {
        state = feature.text;
      }
      
      const result: LocationData = {
        city: city,
        state: state,
        country: country,
        countryCode: countryCode?.toLowerCase(),
        // Mapbox doesn't provide as granular data, so we'll use what we have
        town: city,
        municipality: city,
        suburb: city,
        province: state,
        region: state,
        county: state,
      };
      
      // Cache the result to reduce future API calls
      cacheLocation(lat, lon, result);
      
      ApiLogger.info('mapbox', 'Location data received and cached (fallback)', result);
      
      return result;
    }
    
    throw new Error('No location features in response');
    
  } catch (error) {
    ApiLogger.error('mapbox', 'Failed to fetch location (fallback)', error);
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
  // Check short-lived cache first
  const cacheKey = getWeatherCacheKey(lat, lon);
  const cached = weatherCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < WEATHER_CACHE_TTL_MS) {
    return cached.data;
  }

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
    // Store in cache (even null) to avoid immediate retries on failures
    weatherCache.set(cacheKey, { timestamp: Date.now(), data: result });
    
    return result;
    
  } catch (error) {
    ApiLogger.error('openmeteo', 'Failed to fetch weather/timezone', error);
    // Cache null result briefly to back off repeated failing calls
    weatherCache.set(cacheKey, { timestamp: Date.now(), data: null });
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