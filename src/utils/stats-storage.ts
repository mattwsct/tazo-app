// === 📊 STATS STORAGE UTILITIES ===
// Stream-session based stats: from stream start until stream end
// stream_started_at is set when livestream.status.updated fires with is_live: true
// Stats (HR, altitude, speed, distance, countries, cities) filter by timestamp >= stream_started_at
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
// - KV efficiency: Max ~1000 entries = ~40KB per metric (well under KV limits)

import { kv } from '@vercel/kv';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 1000; // 30 seconds - matches overlay timeout

// Sampling intervals to prevent excessive storage
const HEARTRATE_SAMPLE_INTERVAL = 5 * 1000; // Store heartrate every 5 seconds max (reduced for better data availability)
const SPEED_SAMPLE_INTERVAL = 10 * 1000; // Store speed every 10 seconds max
const ALTITUDE_SAMPLE_INTERVAL = 30 * 1000; // Store altitude every 30 seconds max
const LOCATION_SAMPLE_INTERVAL = 60 * 1000; // Store location every 60 seconds max

// Maximum entries to keep (prevents KV size issues)
const MAX_ENTRIES = 1000; // 1000 entries over 24h = ~1 entry per 1.4 minutes average

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
export const STREAM_STARTED_AT_KEY = 'stream_started_at';
const STREAM_IS_LIVE_KEY = 'stream_is_live';

/**
 * Filters entries to only those since stream started
 */
function filterSinceStreamStart<T extends { timestamp: number }>(
  entries: T[],
  streamStartedAt: number | null
): T[] {
  if (streamStartedAt == null) return [];
  return entries.filter(entry => entry.timestamp >= streamStartedAt);
}

/**
 * Cleans old entries (older than 24h) from array - for storage size limit only
 */
function cleanOldEntries<T extends { timestamp: number }>(entries: T[]): T[] {
  const now = Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  return entries.filter(entry => entry.timestamp > cutoff);
}

/**
 * Called when stream goes live. Sets stream_started_at for session-based stats.
 */
export async function onStreamStarted(): Promise<void> {
  try {
    const now = Date.now();
    await kv.set(STREAM_STARTED_AT_KEY, now);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Stats] Stream started, session reset at', new Date(now).toISOString());
    }
  } catch (error) {
    console.warn('Failed to set stream started:', error);
  }
}

/**
 * Gets stream_started_at timestamp (ms) or null if never set
 */
export async function getStreamStartedAt(): Promise<number | null> {
  try {
    const val = await kv.get<number>(STREAM_STARTED_AT_KEY);
    return typeof val === 'number' ? val : null;
  } catch {
    return null;
  }
}

export async function setStreamLive(live: boolean): Promise<void> {
  await kv.set(STREAM_IS_LIVE_KEY, live);
}

export async function isStreamLive(): Promise<boolean> {
  const val = await kv.get<boolean>(STREAM_IS_LIVE_KEY);
  return val === true;
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
      
      // Debug logging (can be removed later)
      if (process.env.NODE_ENV === 'development') {
        console.log('[Store Heartrate] Received:', bpm, 'BPM, timeSinceLast:', Math.round(timeSinceLast / 1000), 's, bpmChange:', bpmChange);
      }
      
      // Always store if more than 60 seconds have passed (ensures at least one entry per minute)
      const oneMinute = 60 * 1000;
      if (timeSinceLast >= oneMinute) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Store Heartrate] Storing entry - more than 1 minute since last');
        }
      } else {
        // Only store if:
        // 1. Enough time has passed (5s), OR
        // 2. BPM changed significantly (3+ BPM change), OR
        // 3. Timestamp is significantly different (might be from different source)
        if (timeSinceLast < HEARTRATE_SAMPLE_INTERVAL && bpmChange < 3 && Math.abs(timeSinceLast) < 60000) {
          // Skip this reading - too soon, not significant change, and timestamp is reasonable
          // But allow if timestamp is very different (might be correcting a clock issue)
          if (process.env.NODE_ENV === 'development') {
            console.log('[Store Heartrate] Skipping - too soon, small change');
          }
          return;
        }
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[Store Heartrate] Storing entry - condition met');
        }
      }
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Store Heartrate] Storing first entry');
      }
    }
    // Always store if no history exists (first entry)

    const entry: HeartrateEntry = { bpm, timestamp: ts };
    history.push(entry);
    
    // Clean old entries and limit size
    const cleaned = cleanOldEntries(history).slice(-MAX_ENTRIES);
    
    await kv.set(HEARTRATE_KEY, cleaned);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[Store Heartrate] Stored successfully. Total entries:', cleaned.length);
    }
  } catch (error) {
    console.error('Failed to store heartrate:', error);
  }
}

/**
 * Gets heartrate stats (current, min, max, avg) for current stream session
 */
export async function getHeartrateStats(): Promise<{
  current: { bpm: number; age: string } | null;
  min: { bpm: number; age: string } | null;
  max: { bpm: number; age: string } | null;
  avg: number | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt] = await Promise.all([
      kv.get<HeartrateEntry[]>(HEARTRATE_KEY),
      getStreamStartedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSinceStreamStart(entries, streamStartedAt);

    if (process.env.NODE_ENV === 'development' && sessionEntries.length > 0) {
      console.log('[Heartrate Stats] Session entries:', sessionEntries.length, 'since stream start');
    }

    if (sessionEntries.length === 0) {
      return {
        current: null,
        min: null,
        max: null,
        avg: null,
        hasData: false,
      };
    }

    // Most recent entry (current)
    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { bpm: mostRecent.bpm, age: 'current' }
      : { bpm: mostRecent.bpm, age: formatAge(ageMs) };

    // Min/Max
    const bpmValues = sessionEntries.map(e => e.bpm);
    const minBpm = Math.min(...bpmValues);
    const maxBpm = Math.max(...bpmValues);
    
    const minEntry = sessionEntries.find(e => e.bpm === minBpm)!;
    const maxEntry = sessionEntries.find(e => e.bpm === maxBpm)!;
    
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
 * Gets speed stats (current, max) for current stream session
 */
export async function getSpeedStats(): Promise<{
  current: { speed: number; age: string } | null;
  max: { speed: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt] = await Promise.all([
      kv.get<SpeedEntry[]>(SPEED_KEY),
      getStreamStartedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSinceStreamStart(entries, streamStartedAt);

    if (sessionEntries.length === 0) {
      return {
        current: null,
        max: null,
        hasData: false,
      };
    }

    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { speed: mostRecent.speed, age: 'current' }
      : { speed: mostRecent.speed, age: formatAge(ageMs) };

    const speeds = sessionEntries.map(e => e.speed);
    const maxSpeed = Math.max(...speeds);
    const maxEntry = sessionEntries.find(e => e.speed === maxSpeed)!;

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
 * Gets altitude stats (current, highest, lowest) for current stream session
 */
export async function getAltitudeStats(): Promise<{
  current: { altitude: number; age: string } | null;
  highest: { altitude: number; age: string } | null;
  lowest: { altitude: number; age: string } | null;
  hasData: boolean;
}> {
  try {
    const [history, streamStartedAt] = await Promise.all([
      kv.get<AltitudeEntry[]>(ALTITUDE_KEY),
      getStreamStartedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSinceStreamStart(entries, streamStartedAt);

    if (sessionEntries.length === 0) {
      return {
        current: null,
        highest: null,
        lowest: null,
        hasData: false,
      };
    }

    const mostRecent = sessionEntries[sessionEntries.length - 1];
    const now = Date.now();
    const ageMs = now - mostRecent.timestamp;
    const isCurrent = ageMs <= STALE_THRESHOLD_MS;

    const current = isCurrent
      ? { altitude: mostRecent.altitude, age: 'current' }
      : { altitude: mostRecent.altitude, age: formatAge(ageMs) };

    const altitudes = sessionEntries.map(e => e.altitude);
    const highestAlt = Math.max(...altitudes);
    const lowestAlt = Math.min(...altitudes);
    
    const highestEntry = sessionEntries.find(e => e.altitude === highestAlt)!;
    const lowestEntry = sessionEntries.find(e => e.altitude === lowestAlt)!;

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
 * Calculates distance traveled in current stream session (in km)
 */
export async function getDistanceTraveled(): Promise<number | null> {
  try {
    const [history, streamStartedAt] = await Promise.all([
      kv.get<LocationEntry[]>(LOCATION_KEY),
      getStreamStartedAt(),
    ]);
    const entries = history || [];
    const sessionEntries = filterSinceStreamStart(entries, streamStartedAt);

    if (sessionEntries.length < 2) {
      return null;
    }

    // Calculate total distance by summing distances between consecutive points
    let totalDistance = 0;
    for (let i = 1; i < sessionEntries.length; i++) {
      const prev = sessionEntries[i - 1];
      const curr = sessionEntries[i];
      
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
