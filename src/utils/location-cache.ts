// === 📍 LOCATION DATA CACHE ===
// Shared cache for RTIRL, location, weather, and timezone data
// Used by both overlay (updates cache) and chat commands (reads cache)

import { kv } from '@vercel/kv';
import { fetchRTIRLData, type RTIRLData } from './rtirl-utils';
import { fetchLocationFromLocationIQ } from './api-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap } from './api-utils';
import { fetchCurrentWeather, fetchForecast, parseWeatherData, extractPrecipitationForecast } from './weather-chat';
import { getCityLocationForChat } from './chat-utils';
import type { LocationData } from './location-utils';

export interface CachedLocationData {
  rtirl: RTIRLData;
  location: {
    name: string;
    countryCode: string | null;
    country?: string | null;
    // Additional fields for map location string (privacy-conscious: avoid neighbourhood)
    city?: string | null;
    state?: string | null;
    county?: string | null;
    // Full LocationData for formatting (matches overlay display)
    rawLocationData?: LocationData | null;
  } | null;
  weather: {
    condition: string;
    desc: string;
    tempC: number;
    feelsLikeC: number;
    windKmh: number;
    humidity: number;
    visibility: number | null;
  } | null;
  timezone: string | null;
  sunriseSunset: {
    sunrise: number;
    sunset: number;
  } | null;
  forecast: {
    chance: number;
    type: string;
  } | null;
  cachedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes - weather/location can change
const CACHE_KEY = 'location_data_cache';
const PERSISTENT_LOCATION_KEY = 'last_known_location'; // Persistent storage (no TTL)

/**
 * Get cached location data if fresh, otherwise return null
 */
export async function getCachedLocationData(): Promise<CachedLocationData | null> {
  try {
    const cached = await kv.get<CachedLocationData>(CACHE_KEY);
    if (!cached) return null;

    const age = Date.now() - cached.cachedAt;
    if (age > CACHE_TTL) {
      // Cache expired
      return null;
    }

    return cached;
  } catch {
    // KV not available or error - return null to trigger fresh fetch
    return null;
  }
}

/**
 * Update cache with fresh location data
 */
export async function updateLocationCache(data: CachedLocationData): Promise<void> {
  try {
    await kv.set(CACHE_KEY, data, { ex: Math.ceil(CACHE_TTL / 1000) }); // KV TTL in seconds
  } catch (error) {
    // KV not available - silently fail, cache is optional
    console.warn('Failed to update location cache:', error);
  }
}

/**
 * Fetch and cache all location-related data
 */
export async function fetchAndCacheLocationData(): Promise<CachedLocationData | null> {
  try {
    // 1. Fetch RTIRL data
    const rtirlData = await fetchRTIRLData();
    const { lat, lon } = rtirlData;

    if (lat == null || lon == null) {
      return null;
    }

    const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
    const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;

    // 2. Fetch location (parallel with weather)
    const [locationResult, weatherResult] = await Promise.allSettled([
      locationiqKey
        ? fetchLocationFromLocationIQ(lat, lon, locationiqKey)
        : Promise.resolve({ location: null, was404: false }),
      openweatherKey
        ? fetchWeatherAndTimezoneFromOpenWeatherMap(lat, lon, openweatherKey)
        : Promise.resolve(null),
    ]);

    // 3. Parse location
    let location: CachedLocationData['location'] = null;
    if (locationResult.status === 'fulfilled' && locationResult.value.location) {
      const locData = locationResult.value.location;
      const cityLocation = getCityLocationForChat(locData);
      location = {
        name: cityLocation || '',
        countryCode: locData.countryCode || null,
        country: locData.country || null,
        // Store additional fields for map location string (privacy-conscious: avoid neighbourhood)
        city: locData.city || locData.municipality || locData.town || null,
        state: locData.state || locData.province || locData.region || null,
        county: locData.county || null,
        // Store full LocationData for formatting (matches overlay display)
        rawLocationData: locData,
      };
    }

    // 4. Parse weather and timezone
    let weather: CachedLocationData['weather'] = null;
    let timezone: string | null = null;
    let sunriseSunset: CachedLocationData['sunriseSunset'] = null;
    let forecast: CachedLocationData['forecast'] = null;

    // 5. Fetch current weather for detailed data (includes sunrise/sunset timestamps)
    if (openweatherKey) {
      const currentWeather = await fetchCurrentWeather(lat, lon, openweatherKey);
      if (currentWeather) {
        const parsed = parseWeatherData(currentWeather);
        if (parsed) {
          weather = parsed;
        }

        // Extract sunrise/sunset timestamps from OpenWeatherMap response
        if (currentWeather.sys?.sunrise && currentWeather.sys?.sunset) {
          sunriseSunset = {
            sunrise: currentWeather.sys.sunrise, // Unix timestamp
            sunset: currentWeather.sys.sunset,   // Unix timestamp
          };
        }

        // Fetch forecast for precipitation
        const fc = await fetchForecast(lat, lon, openweatherKey);
        if (fc) {
          forecast = extractPrecipitationForecast(fc);
        }
      }
    }

    // Get timezone from weather API
    if (weatherResult.status === 'fulfilled' && weatherResult.value) {
      timezone = weatherResult.value.timezone || null;
    }

    const cachedData: CachedLocationData = {
      rtirl: rtirlData,
      location,
      weather,
      timezone,
      sunriseSunset,
      forecast,
      cachedAt: Date.now(),
    };

    // Update cache (5min TTL for performance)
    await updateLocationCache(cachedData);
    
    // Also update persistent storage (no TTL - always available for chat commands)
    if (location && location.rawLocationData) {
      await updatePersistentLocation({
        location: location.rawLocationData,
        rtirl: rtirlData,
        updatedAt: Date.now(),
      });
    }

    return cachedData;
  } catch (error) {
    console.error('Failed to fetch location data:', error);
    return null;
  }
}

/**
 * Persistent location storage (no TTL - always available)
 */
export interface PersistentLocationData {
  location: LocationData;
  rtirl: RTIRLData;
  updatedAt: number; // Timestamp when last updated
}

/**
 * Update persistent location storage (no TTL)
 * @throws on KV failure (caller should handle)
 */
export async function updatePersistentLocation(data: PersistentLocationData): Promise<void> {
  await kv.set(PERSISTENT_LOCATION_KEY, data); // No TTL - persistent storage
}

/**
 * Update persistent location only if incoming data is newer than stored.
 * Used when overlay sends RTIRL-derived data: don't overwrite browser-set data with stale RTIRL.
 * @returns true if updated, false if skipped (stored was newer)
 */
export async function updatePersistentLocationIfNewer(data: PersistentLocationData): Promise<boolean> {
  const stored = await getPersistentLocation();
  if (stored && stored.updatedAt > data.updatedAt) {
    return false; // Stored is newer (e.g. browser set recently)
  }
  await updatePersistentLocation(data);
  return true;
}

/**
 * Get persistent location data (always available, even if stale)
 */
export async function getPersistentLocation(): Promise<PersistentLocationData | null> {
  try {
    const data = await kv.get<PersistentLocationData>(PERSISTENT_LOCATION_KEY);
    return data;
  } catch (error) {
    console.warn('Failed to get persistent location:', error);
    return null;
  }
}

/**
 * Get location data (from cache if fresh, otherwise fetch fresh)
 */
export async function getLocationData(forceFresh = false): Promise<CachedLocationData | null> {
  if (!forceFresh) {
    const cached = await getCachedLocationData();
    if (cached) return cached;
  }

  return await fetchAndCacheLocationData();
}
