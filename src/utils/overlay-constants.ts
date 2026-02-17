// Overlay configuration constants
export const TIMERS = {
  // Weather updates - time-based only (weather changes regardless of movement)
  WEATHER_UPDATE_INTERVAL: 300000, // 5 minutes - weather changes over time
  
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 60 * 1000, // 1 minute - hide minimap after low speed or no GPS updates
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
  // Stale GPS → broader location display. Balance: cafe (stationary) vs train (moving)
  STALE_NEIGHBOURHOOD_MS: 5 * 60 * 1000,  // 5 min: neighbourhood→city
  STALE_CITY_MS: 10 * 60 * 1000,         // 10 min: city→state (stop there, not country)
  WEATHER_DATA_VALIDITY_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  LOCATION_DATA_VALIDITY_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  
  // Minimap and speed thresholds
  MINIMAP_FADE_DURATION: 1000, // 1 second
  WALKING_PACE_THRESHOLD: 5, // km/h
  SETTINGS_POLLING_INTERVAL: 15000, // 15 seconds (fallback; SSE preferred to stay under KV limits)
  MINIMAP_STALENESS_CHECK_INTERVAL: 1000, // 1 second
  MINIMAP_SPEED_GRACE_PERIOD: 60 * 1000, // 1 minute - grace period before hiding when speed drops below threshold
  MINIMAP_GPS_STALE_GRACE_PERIOD: 60 * 1000, // 1 minute - grace period before hiding when GPS becomes stale
  ONE_MINUTE: 60 * 1000, // 1 minute in milliseconds
  DRAMATIC_CHANGE_THRESHOLD: 50000, // 50km - force immediate fetch for timezone/location updates
  MIN_TIME_SECONDS: 0.5, // Minimum time difference for speed calculation
  SPEED_STALE_DISTANCE_THRESHOLD: 50, // meters - if moved <50m over >10s, consider speed stale
  SPEED_STALE_TIME_THRESHOLD: 10, // seconds - time threshold for stale speed detection
} as const;

// Animation configurations for integer counting - different speeds for different metrics
// Ensures each integer is visible during transitions (70, 71, 72...)

// Heart rate: Moderate speed - changes 1-3 BPM typically, can jump 5-10 during exercise
// 100ms/BPM = 1s for 10 BPM change - fast enough to feel responsive, slow enough to see each number
export const HEART_RATE_ANIMATION = {
  immediateThreshold: 0.1,
  durationMultiplier: 100, // 100ms per BPM
  maxDuration: 2000, // 2 seconds max (for 20+ BPM jumps)
  precision: 0,
} as const;

// Speed: Faster - GPS updates frequently, changes rapidly when accelerating/decelerating
// 80ms/km/h = 0.8s for 10 km/h change - responsive and dynamic feel
export const SPEED_ANIMATION = {
  immediateThreshold: 0.1,
  durationMultiplier: 80, // 80ms per km/h
  maxDuration: 2000, // 2 seconds max (for 25+ km/h changes)
  precision: 0,
} as const;

// Elevation: Slower - changes gradually (1-5m typically), can afford to be more contemplative
// 200ms/m = 2s for 10m change - slower, more deliberate feel
export const ELEVATION_ANIMATION = {
  immediateThreshold: 0.1,
  durationMultiplier: 200, // 200ms per meter
  maxDuration: 4000, // 4 seconds max (for 20+ meter jumps like elevators)
  precision: 0,
} as const;

// Legacy: Keep for backwards compatibility (defaults to heart rate speed)
export const INTEGER_COUNTING_ANIMATION = HEART_RATE_ANIMATION;

export const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  OPENWEATHER: process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY,
  MAPTILER: process.env.NEXT_PUBLIC_MAPTILER_KEY,
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
  altitude?: number | { EGM96?: number; WGS84?: number }; // Altitude in meters (can be number or object with EGM96/WGS84)
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
  timestamp?: number; // Unix timestamp (milliseconds) of when the GPS update was made
  time?: number; // Alternative timestamp field name
} 