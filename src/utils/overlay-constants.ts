// Overlay configuration constants
export const TIMERS = {
  // Weather/Timezone updates
  WEATHER_TIMEZONE_UPDATE: 600000, // 10 minutes
  WEATHER_BACKOFF_MIN: 1200000, // 20 minutes
  WEATHER_BACKOFF_MAX: 3600000, // 60 minutes

  // LocationIQ reverse geocoding
  LOCATION_UPDATE: 180000, // 3 minutes minimum interval
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 10000, // 10s
  SPEED_HIDE_DELAY: 10000, // 10s
  SPEED_DATA_TIMEOUT: 10000, // 10s
  API_COOLDOWN: 60000, // 60s
  FIRST_LOAD_API_COOLDOWN: 10000, // 10s

  // Static map refresh (by speed bucket)
  MAP_MIN_INTERVAL_SLOW: 30000,  // <10 km/h
  MAP_MIN_INTERVAL_MED: 15000,   // 10–50 km/h
  MAP_MIN_INTERVAL_FAST: 8000,   // >50 km/h
} as const;

export const THRESHOLDS = {
  LOCATION_DISTANCE: 750, // meters, gate for reverse geocoding
  WEATHER_DISTANCE_KM: 10, // km, trigger weather refresh on large moves
  SPEED_SHOW: 10, // 10 km/h
  SPEED_READINGS_REQUIRED: 2,
  HIGH_SPEED_THRESHOLD: 50, // km/h
  BULLET_TRAIN_SPEED: 200, // km/h
  // Static map gate
  MAP_PIXEL_CHANGE: 8, // minimum pixel movement to refresh image
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