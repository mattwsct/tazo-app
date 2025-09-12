// Overlay configuration constants
export const TIMERS = {
  // Weather/Timezone updates - more aggressive with Vercel Pro
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes (was 10 minutes)
  WEATHER_BACKOFF_MIN: 600000, // 10 minutes (was 20 minutes)
  WEATHER_BACKOFF_MAX: 1800000, // 30 minutes (was 60 minutes)

  // LocationIQ reverse geocoding - more aggressive but still conservative
  LOCATION_UPDATE: 180000, // 3 minutes minimum interval (was 5 minutes)
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 10000, // 10s
  SPEED_HIDE_DELAY: 10000, // 10s
  SPEED_DATA_TIMEOUT: 10000, // 10s
  API_COOLDOWN: 60000, // 60s
  FIRST_LOAD_API_COOLDOWN: 10000, // 10s

  // Static map refresh (by speed bucket) - more responsive
  MAP_MIN_INTERVAL_SLOW: 20000,  // <10 km/h (was 30s)
  MAP_MIN_INTERVAL_MED: 10000,   // 10–50 km/h (was 15s)
  MAP_MIN_INTERVAL_FAST: 6000,   // >50 km/h (was 8s)
} as const;

export const THRESHOLDS = {
  // Location distance thresholds based on area type for API efficiency
  LOCATION_DISTANCE_NEIGHBORHOOD: 200, // meters - very frequent for neighborhoods
  LOCATION_DISTANCE_SUBURB: 500, // meters - frequent for suburbs
  LOCATION_DISTANCE_CITY: 1000, // meters - moderate for cities
  LOCATION_DISTANCE_STATE: 5000, // meters - less frequent for states/countries
  LOCATION_DISTANCE_DEFAULT: 1000, // meters - default fallback
  
  WEATHER_DISTANCE_KM: 5, // km, reduced for more responsive weather updates
  SPEED_SHOW: 10, // 10 km/h
  SPEED_READINGS_REQUIRED: 2,
  HIGH_SPEED_THRESHOLD: 50, // km/h
  BULLET_TRAIN_SPEED: 200, // km/h
  // Static map gate
  MAP_PIXEL_CHANGE: 8, // minimum pixel movement to refresh image
  
  // Movement-based intelligence thresholds
  STATIONARY_THRESHOLD: 5, // km/h - consider stationary below this speed
  MOVING_THRESHOLD: 20, // km/h - consider actively moving above this speed
  HIGH_SPEED_MOVEMENT: 80, // km/h - high speed movement
} as const;

// Dynamic polling intervals based on movement state
export const DYNAMIC_TIMERS = {
  // Weather polling based on movement
  WEATHER_STATIONARY: 600000, // 10 minutes when stationary
  WEATHER_MOVING: 300000, // 5 minutes when moving
  WEATHER_HIGH_SPEED: 180000, // 3 minutes when moving fast
  
  // Location polling based on movement - optimized for IRL streaming
  LOCATION_STATIONARY: 300000, // 5 minutes when stationary (reduced from 10)
  LOCATION_MOVING: 60000, // 1 minute when moving (reduced from 3 minutes)
  LOCATION_HIGH_SPEED: 30000, // 30 seconds when moving fast (reduced from 2 minutes)
  
  // Map updates based on speed
  MAP_STATIONARY: 60000, // 1 minute when stationary
  MAP_MOVING: 20000, // 20 seconds when moving
  MAP_HIGH_SPEED: 10000, // 10 seconds when moving fast
} as const;

export const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

// API rate limits for free tiers (per-second only, no daily limits since overlay refreshes)
export const API_RATE_LIMITS = {
  LOCATIONIQ_FREE: {
    PER_SECOND_LIMIT: 1,
    COOLDOWN_MS: 1000, // 1 second between calls
  },
  MAPBOX_FREE: {
    PER_SECOND_LIMIT: 10,
    COOLDOWN_MS: 100, // 100ms between calls
  },
} as const;

// Location granularity levels for smart update frequency
export const LOCATION_GRANULARITY = {
  NEIGHBORHOOD: 'neighbourhood',
  SUBURB: 'suburb', 
  TOWN: 'town',
  CITY: 'city',
  STATE: 'state',
  COUNTRY: 'country',
} as const;

// Weather mapping constants
// Removed weather icon mapping and fallback map since icon rendering was removed

// Type definitions for better readability
export interface SpeedBasedElementState {
  visible: boolean;
  aboveThresholdCount: number;
  lastSpeedUpdate: number;
}

export interface MinimapState extends SpeedBasedElementState {
  currentMode: 'hidden' | 'manual' | 'speed-based';
}

export interface SpeedBasedElements {
  minimap: MinimapState;
  speedIndicator: SpeedBasedElementState;
}

export interface TimeoutRefs {
  speedHide: NodeJS.Timeout | null;
  speedData: NodeJS.Timeout | null;
  speedIndicatorHide: NodeJS.Timeout | null;
  minimap: NodeJS.Timeout | null;
  overlay: NodeJS.Timeout | null;
}

export interface RTIRLPayload {
  speed?: number;
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
} 