// === 📍 LOCATION DATA CACHE ===
// Shared cache for RTIRL, location, weather, and timezone data
// Used by both overlay (updates cache) and chat commands (reads cache)

import { kv } from '@/lib/kv';
import { fetchRTIRLData, type RTIRLData } from './rtirl-utils';
import { fetchLocationFromLocationIQ, getTimezoneFromOwmOffset } from './api-utils';
import { fetchCurrentWeather, fetchForecast, parseWeatherData, extractPrecipitationForecast, fetchAirPollution, fetchUVIndex } from './weather-chat';
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
    uvIndex?: number | null;
    aqi?: number | null;
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
const LOCATION_CACHE_LAST_FETCH_KEY = 'location_cache_last_fetch'; // Cooldown to avoid burst API usage
const LAST_OVERLAY_GEOCODE_AT_KEY = 'last_overlay_geocode_at'; // Throttle overlay-triggered geocode (20s)
const MIN_FETCH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes minimum between fetches (OpenWeatherMap: 60/min, we do ~4 calls per fetch)
const OVERLAY_GEOCODE_THROTTLE_MS = 20 * 1000; // 20s between overlay-triggered geocodes

/**
 * Get cached location data if fresh, otherwise return null.
 * @param allowStale - If true, return cache even if expired (e.g. when rate limited)
 */
export async function getCachedLocationData(allowStale = false): Promise<CachedLocationData | null> {
  try {
    const cached = await kv.get<CachedLocationData>(CACHE_KEY);
    if (!cached) return null;

    const age = Date.now() - cached.cachedAt;
    if (age > CACHE_TTL && !allowStale) return null;

    return cached;
  } catch {
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
    // 0. Cooldown: avoid burst API usage (OpenWeatherMap free: 60/min; we make ~4 calls per fetch)
    const lastFetch = await kv.get<number>(LOCATION_CACHE_LAST_FETCH_KEY);
    const now = Date.now();
    if (typeof lastFetch === 'number' && now - lastFetch < MIN_FETCH_INTERVAL_MS) {
      const cached = await getCachedLocationData(true); // Allow stale when cooldown active
      if (cached) return cached;
    }

    // 1. Fetch RTIRL data
    const rtirlData = await fetchRTIRLData();
    const { lat, lon } = rtirlData;

    if (lat == null || lon == null) {
      return null;
    }

    const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
    const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;

    // 2. Fetch location and current weather in parallel (single OWM call instead of two)
    const [locationResult, currentWeather] = await Promise.allSettled([
      locationiqKey
        ? fetchLocationFromLocationIQ(lat, lon, locationiqKey)
        : Promise.resolve({ location: null, was404: false }),
      openweatherKey ? fetchCurrentWeather(lat, lon, openweatherKey) : Promise.resolve(null),
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

    // 4. Parse weather, timezone, sunrise/sunset from current weather
    let weather: CachedLocationData['weather'] = null;
    let timezone: string | null = null;
    let sunriseSunset: CachedLocationData['sunriseSunset'] = null;
    let forecast: CachedLocationData['forecast'] = null;

    const ow = currentWeather.status === 'fulfilled' ? currentWeather.value : null;
    if (ow) {
      const parsed = parseWeatherData(ow);
      if (parsed) weather = parsed;
      if (ow.sys?.sunrise && ow.sys?.sunset) {
        sunriseSunset = { sunrise: ow.sys.sunrise, sunset: ow.sys.sunset };
      }
      if (typeof ow.timezone === 'number') {
        timezone = getTimezoneFromOwmOffset(ow.timezone, lat, lon);
      }
    }

    // 5. Fetch forecast, UV, and air quality (2–3 additional OWM calls; staggered to avoid burst)
    if (openweatherKey && weather) {
      const fc = await fetchForecast(lat, lon, openweatherKey);
      if (fc) forecast = extractPrecipitationForecast(fc);
      const [uvRes, aqiRes] = await Promise.allSettled([
        fetchUVIndex(lat, lon, openweatherKey),
        fetchAirPollution(lat, lon, openweatherKey),
      ]);
      weather.uvIndex = uvRes.status === 'fulfilled' ? uvRes.value : null;
      weather.aqi = aqiRes.status === 'fulfilled' ? aqiRes.value : null;
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
    await kv.set(LOCATION_CACHE_LAST_FETCH_KEY, Date.now());

    // Also update persistent storage (no TTL - always available for chat commands)
    // Store geocodedLat/geocodedLon so updatePersistentRtirlOnly can detect when GPS
    // has moved significantly and invalidate the cache proactively.
    if (location && location.rawLocationData) {
      await updatePersistentLocation({
        location: location.rawLocationData,
        rtirl: rtirlData,
        updatedAt: Date.now(),
        geocodedLat: rtirlData.lat ?? undefined,
        geocodedLon: rtirlData.lon ?? undefined,
      });
    }

    return cachedData;
  } catch (error) {
    console.error('Failed to fetch location data:', error);
    return null;
  }
}

/**
 * Persistent location storage (no TTL - always available).
 * `location` is optional: the overlay POST only stores GPS coords; geocoded text comes from the cron.
 * `geocodedLat/geocodedLon` tracks the GPS position used for the last geocoding run —
 * compared against `rtirl` to detect movement and trigger cache invalidation.
 */
export interface PersistentLocationData {
  location?: LocationData;
  rtirl: RTIRLData;
  updatedAt: number; // Timestamp when last updated
  geocodedLat?: number; // Lat at time of last geocoding
  geocodedLon?: number; // Lon at time of last geocoding
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
 * Update only the RTIRL coordinates in persistent storage, preserving the existing geocoded location text.
 * Used by the public overlay POST endpoint — accepts GPS coords only, never user-supplied city names.
 *
 * When GPS has moved >300m from the last geocoded position, the location data cache is invalidated
 * so the next cron run re-geocodes immediately (instead of waiting for the 5-min TTL).
 *
 * @returns true if updated, false if skipped (stored was newer)
 */
export async function updatePersistentRtirlOnly(rtirl: RTIRLData, updatedAt: number): Promise<boolean> {
  const stored = await getPersistentLocation();
  if (stored && stored.updatedAt > updatedAt) {
    return false; // Stored is newer
  }

  // If GPS has moved >300m from the last geocoded position, invalidate the location cache.
  // ~0.003 degrees latitude ≈ 333m; longitude precision varies by latitude but is a safe approximation.
  const prevLat = stored?.geocodedLat;
  const prevLon = stored?.geocodedLon;
  if (prevLat != null && prevLon != null && rtirl.lat != null && rtirl.lon != null) {
    const movedLat = Math.abs(rtirl.lat - prevLat) > 0.003;
    const movedLon = Math.abs(rtirl.lon - prevLon) > 0.003;
    if (movedLat || movedLon) {
      // Delete the timed cache so the next getLocationData(false) call triggers fresh geocoding
      await kv.del(CACHE_KEY);
    }
  }

  await kv.set(PERSISTENT_LOCATION_KEY, {
    ...(stored ?? {}),
    rtirl,
    updatedAt,
  });
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

/**
 * Geocode using coords from persistent storage (overlay just sent them), update persistent location
 * and cache so admin/GET location and stream title see the new location immediately.
 * Throttled to once per OVERLAY_GEOCODE_THROTTLE_MS to avoid API burst.
 * Call fire-and-forget from POST /api/location after updatePersistentRtirlOnly.
 * After this returns, caller should call pushStreamTitleFromLocation() to update Kick title.
 */
export async function geocodeFromPersistentAndUpdateCache(): Promise<boolean> {
  try {
    const persistent = await getPersistentLocation();
    const lat = persistent?.rtirl?.lat;
    const lon = persistent?.rtirl?.lon;
    if (lat == null || lon == null || typeof lat !== 'number' || typeof lon !== 'number') return false;

    const now = Date.now();
    // Atomic claim — prevents duplicate geocode calls when multiple overlay tabs POST simultaneously.
    const claimed = await kv.set(LAST_OVERLAY_GEOCODE_AT_KEY, now, { nx: true, ex: Math.ceil(OVERLAY_GEOCODE_THROTTLE_MS / 1000) });
    if (claimed === null) return false; // Another tab already claimed this window

    const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
    const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;

    const [locationResult, currentWeather] = await Promise.allSettled([
      locationiqKey ? fetchLocationFromLocationIQ(lat, lon, locationiqKey) : Promise.resolve({ location: null, was404: false }),
      openweatherKey ? fetchCurrentWeather(lat, lon, openweatherKey) : Promise.resolve(null),
    ]);

    let location: CachedLocationData['location'] = null;
    let rawLocationData: LocationData | null = null;
    if (locationResult.status === 'fulfilled' && locationResult.value.location) {
      const locData = locationResult.value.location;
      rawLocationData = locData;
      const cityLocation = getCityLocationForChat(locData);
      location = {
        name: cityLocation || '',
        countryCode: locData.countryCode || null,
        country: locData.country || null,
        city: locData.city || locData.municipality || locData.town || null,
        state: locData.state || locData.province || locData.region || null,
        county: locData.county || null,
        rawLocationData: locData,
      };
    }

    let weather: CachedLocationData['weather'] = null;
    let timezone: string | null = null;
    let sunriseSunset: CachedLocationData['sunriseSunset'] = null;
    const ow = currentWeather.status === 'fulfilled' ? currentWeather.value : null;
    if (ow) {
      const parsed = parseWeatherData(ow);
      if (parsed) weather = parsed;
      if (ow.sys?.sunrise && ow.sys?.sunset) {
        sunriseSunset = { sunrise: ow.sys.sunrise, sunset: ow.sys.sunset };
      }
      if (typeof ow.timezone === 'number') {
        timezone = getTimezoneFromOwmOffset(ow.timezone, lat, lon);
      }
    }

    const rtirlData: RTIRLData = persistent!.rtirl;
    const cachedData: CachedLocationData = {
      rtirl: rtirlData,
      location,
      weather,
      timezone,
      sunriseSunset,
      forecast: null,
      cachedAt: now,
    };
    await updateLocationCache(cachedData);

    if (rawLocationData) {
      await updatePersistentLocation({
        ...(persistent ?? { rtirl: rtirlData, updatedAt: now }),
        location: rawLocationData,
        rtirl: rtirlData,
        updatedAt: now,
        geocodedLat: lat,
        geocodedLon: lon,
      });
    }

    return true;
  } catch (error) {
    console.warn('Geocode from persistent failed:', error);
    return false;
  }
}
