// Overlay configuration constants
export const TIMERS = {
  // Weather updates - time-based only (weather changes regardless of movement)
  WEATHER_UPDATE_INTERVAL: 300000, // 5 minutes - weather changes over time
  
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
  // Location threshold - weather doesn't need movement threshold
  LOCATION_MOVEMENT_THRESHOLD: 10, // meters - more responsive for IRL streaming
  
  SPEED_SHOW: 10, // 10 km/h
  SPEED_READINGS_REQUIRED: 2,
  HIGH_SPEED_THRESHOLD: 50, // km/h
  BULLET_TRAIN_SPEED: 200, // km/h
  // Static map gate
  MAP_PIXEL_CHANGE: 8, // minimum pixel movement to refresh image
  
} as const;

// Simplified polling intervals
export const DYNAMIC_TIMERS = {
  // Unified update intervals
  UPDATE_INTERVAL: 60000, // 1 minute
  MOVEMENT_THRESHOLD: 10, // 10 meters
} as const;

export const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  OPENWEATHER: process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY,
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