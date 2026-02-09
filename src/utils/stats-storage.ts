// === 📊 STATS STORAGE UTILITIES ===
// Timestamp-based rolling 24-hour window for stats tracking
// Avoids timezone issues by using Unix timestamps (UTC)
//
// SMART SAMPLING STRATEGY:
// To prevent excessive storage from high-frequency updates (RTIRL spam, frequent heartrate):
// - Time-based sampling: Only store entries at fixed intervals (15-60s depending on metric)
// - Change-based sampling: Always store if value changed significantly (even if recent)
// - Max entries: Limit to 500 entries per metric (prevents KV size issues)
// - Auto-cleanup: Remove entries older than 24h on every write
//
// This ensures:
// - Stable values: ~1 entry per 15-60 seconds (manageable storage)
// - Rapid changes: Captured immediately (no data loss during spikes)
// - KV efficiency: Max ~500 entries = ~20KB per metric (well under KV limits)

import { kv } from '@vercel/kv';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 1000; // 30 seconds - matches overlay timeout

// Sampling intervals to prevent excessive storage
const HEARTRATE_SAMPLE_INTERVAL = 15 * 1000; // Store heartrate every 15 seconds max
const SPEED_SAMPLE_INTERVAL = 10 * 1000; // Store speed every 10 seconds max
const ALTITUDE_SAMPLE_INTERVAL = 30 * 1000; // Store altitude every 30 seconds max
const LOCATION_SAMPLE_INTERVAL = 60 * 1000; // Store location every 60 seconds max

// Maximum entries to keep (prevents KV size issues)
const MAX_ENTRIES = 500; // Reduced from 1000 - 500 entries over 24h = ~1 entry per 3 minutes average

export interface HeartrateEntry {
  bpm: number;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface SpeedEntry {
  speed: number; // km/h
  timestamp: number;
}

export interface AltitudeEntry {
  altitude: number; // meters
  timestamp: number;
}

export interface LocationEntry {
  lat: number;
  lon: number;
  timestamp: number;
}

// KV Keys
const HEARTRATE_KEY = 'heartrate_history';
const SPEED_KEY = 'speed_history';
const ALTITUDE_KEY = 'altitude_history';
const LOCATION_KEY = 'location_history';
const COUNTRIES_KEY = 'countries_visited';
const CITIES_KEY = 'cities_visited';

/**
 * Filters entries to only those within the last 24 hours
 */
function filter24h<T extends { timestamp: number }>(entries: T[]): T[] {
  const now = Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  return entries.filter(entry => entry.timestamp > cutoff);
}

/**
 * Cleans old entries (older than 24h) from array
 */
function cleanOldEntries<T extends { timestamp: number }>(entries: T[]): T[] {
  return filter24h(entries);
}

/**
 * Formats age in human-readable format
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

// === 💗 HEARTRATE STATS ===

/**
 * Stores a heartrate reading with smart sampling
 * Only stores if enough time has passed since last entry or BPM changed significantly
 */
export async function storeHeartrate(bpm: number, timestamp?: number): Promise<void> {
  try {
    const ts = timestamp || Date.now();
    const history = await kv.get<HeartrateEntry[]>(HEARTRATE_KEY) || [];
    
    // Check if we should sample this reading
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const bpmChange = Math.abs(bpm - lastEntry.bpm);
      
      // Only store if:
      // 1. Enough time has passed (15s), OR
      // 2. BPM changed significantly (5+ BPM change)
      if (timeSinceLast < HEARTRATE_SAMPLE_INTERVAL && bpmChange < 5) {
        return; // Skip this reading - too soon and not significant change
      }
    }

    const entry: HeartrateEntry = { bpm, timestamp: ts };
    history.push(entry);
    
    // Clean old entries and limit size
    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    
    await kv.set(HEARTRATE_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store heartrate:', error);
  }
}

/**
 * Gets heartrate stats (current, min, max, avg) for last 24h
 */
export async function getHeartrateStats(): Promise<{
  current: { bpm: number; age: string } | null;
  min: { bpm: number; age: string } | null;
  max: { bpm: number; age: string } | null;
  avg: number | null;
  hasData: boolean;
}> {
  try {
    const history = await kv.get<HeartrateEntry[]>(HEARTRATE_KEY) || [];
    const recent24h = filter24h(history);

    if (recent24h.length === 0) {
      return {
        current: null,
        min: null,
        max: null,
        avg: null,
        hasData: false,
      };
    }

    // Most recent entry (current)
    const mostRecent = recent24h[recent24h.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { bpm: mostRecent.bpm, age: 'current' }
      : { bpm: mostRecent.bpm, age: formatAge(ageMs) };

    // Min/Max
    const bpmValues = recent24h.map(e => e.bpm);
    const minBpm = Math.min(...bpmValues);
    const maxBpm = Math.max(...bpmValues);
    
    const minEntry = recent24h.find(e => e.bpm === minBpm)!;
    const maxEntry = recent24h.find(e => e.bpm === maxBpm)!;
    
    const min = {
      bpm: minBpm,
      age: formatAge(now - minEntry.timestamp),
    };
    
    const max = {
      bpm: maxBpm,
      age: formatAge(now - maxEntry.timestamp),
    };

    // Average
    const avg = Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length);

    return {
      current,
      min,
      max,
      avg,
      hasData: true,
    };
  } catch (error) {
    console.warn('Failed to get heartrate stats:', error);
    return {
      current: null,
      min: null,
      max: null,
      avg: null,
      hasData: false,
    };
  }
}

// === 🚗 SPEED STATS ===

/**
 * Stores a speed reading with smart sampling
 * Only stores if enough time has passed since last entry or speed changed significantly
 */
export async function storeSpeed(speed: number, timestamp?: number): Promise<void> {
  try {
    const ts = timestamp || Date.now();
    const history = await kv.get<SpeedEntry[]>(SPEED_KEY) || [];
    
    // Check if we should sample this reading
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const speedChange = Math.abs(speed - lastEntry.speed);
      
      // Only store if:
      // 1. Enough time has passed (10s), OR
      // 2. Speed changed significantly (5+ km/h change)
      if (timeSinceLast < SPEED_SAMPLE_INTERVAL && speedChange < 5) {
        return; // Skip this reading
      }
    }

    const entry: SpeedEntry = { speed, timestamp: ts };
    history.push(entry);
    
    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(SPEED_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store speed:', error);
  }
}

/**
 * Gets speed stats (current, max) for last 24h
 */
export async function getSpeedStats(): Promise<{
  current: { speed: number; age: string } | null;
  max: { speed: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const history = await kv.get<SpeedEntry[]>(SPEED_KEY) || [];
    const recent24h = filter24h(history);

    if (recent24h.length === 0) {
      return {
        current: null,
        max: null,
        hasData: false,
      };
    }

    const mostRecent = recent24h[recent24h.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { speed: mostRecent.speed, age: 'current' }
      : { speed: mostRecent.speed, age: formatAge(ageMs) };

    const speeds = recent24h.map(e => e.speed);
    const maxSpeed = Math.max(...speeds);
    const maxEntry = recent24h.find(e => e.speed === maxSpeed)!;

    const max = {
      speed: maxSpeed,
      age: formatAge(now - maxEntry.timestamp),
    };

    return {
      current,
      max,
      hasData: true,
    };
  } catch (error) {
    console.warn('Failed to get speed stats:', error);
    return {
      current: null,
      max: null,
      hasData: false,
    };
  }
}

// === ⛰️ ALTITUDE STATS ===

/**
 * Stores an altitude reading with smart sampling
 * Only stores if enough time has passed since last entry or altitude changed significantly
 */
export async function storeAltitude(altitude: number, timestamp?: number): Promise<void> {
  try {
    const ts = timestamp || Date.now();
    const history = await kv.get<AltitudeEntry[]>(ALTITUDE_KEY) || [];
    
    // Check if we should sample this reading
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      const altitudeChange = Math.abs(altitude - lastEntry.altitude);
      
      // Only store if:
      // 1. Enough time has passed (30s), OR
      // 2. Altitude changed significantly (20+ meters change)
      if (timeSinceLast < ALTITUDE_SAMPLE_INTERVAL && altitudeChange < 20) {
        return; // Skip this reading
      }
    }

    const entry: AltitudeEntry = { altitude, timestamp: ts };
    history.push(entry);
    
    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(ALTITUDE_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store altitude:', error);
  }
}

/**
 * Gets altitude stats (current, highest, lowest) for last 24h
 */
export async function getAltitudeStats(): Promise<{
  current: { altitude: number; age: string } | null;
  highest: { altitude: number; age: string } | null;
  lowest: { altitude: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const history = await kv.get<AltitudeEntry[]>(ALTITUDE_KEY) || [];
    const recent24h = filter24h(history);

    if (recent24h.length === 0) {
      return {
        current: null,
        highest: null,
        lowest: null,
        hasData: false,
      };
    }

    const mostRecent = recent24h[recent24h.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { altitude: mostRecent.altitude, age: 'current' }
      : { altitude: mostRecent.altitude, age: formatAge(ageMs) };

    const altitudes = recent24h.map(e => e.altitude);
    const highestAlt = Math.max(...altitudes);
    const lowestAlt = Math.min(...altitudes);
    
    const highestEntry = recent24h.find(e => e.altitude === highestAlt)!;
    const lowestEntry = recent24h.find(e => e.altitude === lowestAlt)!;

    const highest = {
      altitude: highestAlt,
      age: formatAge(now - highestEntry.timestamp),
    };

    const lowest = {
      altitude: lowestAlt,
      age: formatAge(now - lowestEntry.timestamp),
    };

    return {
      current,
      highest,
      lowest,
      hasData: true,
    };
  } catch (error) {
    console.warn('Failed to get altitude stats:', error);
    return {
      current: null,
      highest: null,
      lowest: null,
      hasData: false,
    };
  }
}

// === 📍 LOCATION STATS ===

/**
 * Stores a location reading with smart sampling
 * Only stores if enough time has passed or moved significant distance
 */
export async function storeLocation(lat: number, lon: number, timestamp?: number): Promise<void> {
  try {
    const ts = timestamp || Date.now();
    const history = await kv.get<LocationEntry[]>(LOCATION_KEY) || [];
    
    // Check if we should sample this reading
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const timeSinceLast = ts - lastEntry.timestamp;
      
      // Calculate distance moved (Haversine formula)
      const R = 6371; // Earth's radius in km
      const dLat = (lat - lastEntry.lat) * Math.PI / 180;
      const dLon = (lon - lastEntry.lon) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lastEntry.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = R * c;
      
      // Only store if:
      // 1. Enough time has passed (60s), OR
      // 2. Moved significant distance (100+ meters)
      if (timeSinceLast < LOCATION_SAMPLE_INTERVAL && distanceKm < 0.1) {
        return; // Skip this reading - too soon and didn't move much
      }
    }

    const entry: LocationEntry = { lat, lon, timestamp: ts };
    history.push(entry);
    
    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    await kv.set(LOCATION_KEY, cleaned);
  } catch (error) {
    console.warn('Failed to store location:', error);
  }
}

/**
 * Calculates distance traveled in last 24h (in km)
 */
export async function getDistanceTraveled(): Promise<number | null> {
  try {
    const history = await kv.get<LocationEntry[]>(LOCATION_KEY) || [];
    const recent24h = filter24h(history);

    if (recent24h.length < 2) {
      return null;
    }

    // Calculate total distance by summing distances between consecutive points
    let totalDistance = 0;
    for (let i = 1; i < recent24h.length; i++) {
      const prev = recent24h[i - 1];
      const curr = recent24h[i];
      
      // Haversine formula for distance between two points
      const R = 6371; // Earth's radius in km
      const dLat = (curr.lat - prev.lat) * Math.PI / 180;
      const dLon = (curr.lon - prev.lon) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      totalDistance += distance;
    }

    return Math.round(totalDistance * 10) / 10; // Round to 1 decimal
  } catch (error) {
    console.warn('Failed to calculate distance:', error);
    return null;
  }
}

/**
 * Adds a country to visited countries (last 24h)
 */
export async function addCountry(countryCode: string): Promise<void> {
  try {
    const countries = await kv.get<Set<string>>(COUNTRIES_KEY) || new Set<string>();
    countries.add(countryCode);
    
    // Clean old entries - we'll just keep the set, no timestamp needed
    // Countries don't change frequently, so this is fine
    await kv.set(COUNTRIES_KEY, countries);
  } catch (error) {
    console.warn('Failed to add country:', error);
  }
}

/**
 * Gets countries visited in last 24h
 */
export async function getCountriesVisited(): Promise<string[]> {
  try {
    const countries = await kv.get<Set<string>>(COUNTRIES_KEY) || new Set<string>();
    return Array.from(countries);
  } catch (error) {
    console.warn('Failed to get countries:', error);
    return [];
  }
}

/**
 * Adds a city to visited cities (last 24h)
 */
export async function addCity(cityName: string): Promise<void> {
  try {
    const cities = await kv.get<Set<string>>(CITIES_KEY) || new Set<string>();
    cities.add(cityName);
    await kv.set(CITIES_KEY, cities);
  } catch (error) {
    console.warn('Failed to add city:', error);
  }
}

/**
 * Gets cities visited in last 24h
 */
export async function getCitiesVisited(): Promise<string[]> {
  try {
    const cities = await kv.get<Set<string>>(CITIES_KEY) || new Set<string>();
    return Array.from(cities);
  } catch (error) {
    console.warn('Failed to get cities:', error);
    return [];
  }
}
