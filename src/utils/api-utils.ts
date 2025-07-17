import { 
  checkRateLimit, 
  mapWMOToOpenWeatherIcon, 
  mapWMOToDescription,
  type LocationData 
} from './overlay-utils';

// === 🌐 API LOGGER ===
const ApiLogger = {
  info: (api: string, message: string, data?: unknown) => 
    console.log(`🌐 [${api.toUpperCase()} API] ${message}`, data || ''),
  error: (api: string, message: string, error?: unknown) => 
    console.error(`🌐 [${api.toUpperCase()} API ERROR] ${message}`, error || ''),
  warn: (api: string, message: string, data?: unknown) => 
    console.warn(`🌐 [${api.toUpperCase()} API WARNING] ${message}`, data || ''),
} as const;

// === 🌤️ WEATHER TYPES ===
export interface WeatherData {
  temp: number;
  icon: string;
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
 */
export async function fetchLocationFromLocationIQ(
  lat: number, 
  lon: number, 
  apiKey: string
): Promise<LocationData | null> {
  if (!apiKey || !checkRateLimit('locationiq')) {
    ApiLogger.warn('locationiq', 'API call skipped', { 
      hasKey: !!apiKey, 
      rateLimitOk: checkRateLimit('locationiq') 
    });
    return null;
  }

  try {
    ApiLogger.info('locationiq', 'Fetching location data', { lat, lon });
    
    const response = await fetch(
      `https://us1.locationiq.com/v1/reverse.php?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en`
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
  if (!checkRateLimit('openmeteo')) {
    ApiLogger.warn('openmeteo', 'Rate limit exceeded, skipping API call');
    return null;
  }
  
  try {
    ApiLogger.info('openmeteo', 'Fetching weather and timezone data', { lat, lon });
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto&forecast_days=1`;
    
    const response = await fetch(url);
    
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
        icon: mapWMOToOpenWeatherIcon(data.current.weather_code),
        desc: mapWMOToDescription(data.current.weather_code),
      };
      
      ApiLogger.info('openmeteo', 'Weather data received', weather);
    }
    
    // Extract timezone data
    if (data.timezone && typeof data.timezone === 'string') {
      timezone = data.timezone;
      ApiLogger.info('openmeteo', 'Timezone data received', { timezone });
    }
    
    return { weather, timezone };
    
  } catch (error) {
    ApiLogger.error('openmeteo', 'Failed to fetch weather/timezone', error);
    return null;
  }
} 