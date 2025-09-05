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
  LOCATION_DISTANCE: 1500, // meters, increased from 750 to reduce API calls
  WEATHER_DISTANCE_KM: 10, // km, trigger weather refresh on large moves
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
  
  // Location polling based on movement
  LOCATION_STATIONARY: 600000, // 10 minutes when stationary
  LOCATION_MOVING: 180000, // 3 minutes when moving
  LOCATION_HIGH_SPEED: 120000, // 2 minutes when moving fast
  
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