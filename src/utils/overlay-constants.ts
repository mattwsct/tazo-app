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
  
  // GPS freshness and staleness timeouts
  GPS_FRESHNESS_TIMEOUT: 15 * 60 * 1000, // 15 minutes
  GPS_STALE_TIMEOUT: 10000, // 10 seconds
  WEATHER_DATA_VALIDITY_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  LOCATION_DATA_VALIDITY_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  
  // Minimap and speed thresholds
  MINIMAP_FADE_DURATION: 1000, // 1 second
  WALKING_PACE_THRESHOLD: 5, // km/h
  SETTINGS_POLLING_INTERVAL: 2000, // 2 seconds
  MINIMAP_STALENESS_CHECK_INTERVAL: 1000, // 1 second
  MINIMAP_SPEED_GRACE_PERIOD: 60 * 1000, // 1 minute - grace period before hiding when speed drops below threshold
  MINIMAP_GPS_STALE_GRACE_PERIOD: 60 * 1000, // 1 minute - grace period before hiding when GPS becomes stale
} as const;

export const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  OPENWEATHER: process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY,
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
  timestamp?: number; // Unix timestamp (milliseconds) of when the GPS update was made
  time?: number; // Alternative timestamp field name
} 