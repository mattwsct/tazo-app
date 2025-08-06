// Overlay configuration constants
export const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes
  LOCATION_UPDATE: 60000, // 60s
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 10000, // 10s
  SPEED_HIDE_DELAY: 10000, // 10s
  SPEED_DATA_TIMEOUT: 10000, // 10s
  API_COOLDOWN: 60000, // 60s
  FIRST_LOAD_API_COOLDOWN: 10000, // 10s
} as const;

export const THRESHOLDS = {
  LOCATION_DISTANCE: 100, // 100m
  SPEED_SHOW: 10, // 10 km/h
  SPEED_READINGS_REQUIRED: 2,
  HIGH_SPEED_THRESHOLD: 50, // km/h
  BULLET_TRAIN_SPEED: 200, // km/h
} as const;

export const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

// Weather mapping constants
export const WMO_TO_OPENWEATHER: Record<string, string> = {
  '0': '01', '1': '02', '2': '03', '3': '04',
  '45': '50', '48': '50', '51': '09', '53': '09', '55': '09',
  '56': '13', '57': '13', '61': '10', '63': '10', '65': '10',
  '66': '13', '67': '13', '71': '13', '73': '13', '75': '13',
  '77': '13', '80': '09', '81': '09', '82': '09', '85': '13',
  '86': '13', '95': '11', '96': '11', '99': '11',
} as const;

export const WEATHER_FALLBACK_MAP: Record<string, string> = {
  '0': '☀️', '1': '🌤️', '2': '⛅', '3': '☁️',
  '45': '🌫️', '48': '🌫️', '51': '🌦️', '53': '🌦️', '55': '🌧️',
  '56': '🌨️', '57': '🌨️', '61': '🌧️', '63': '🌧️', '65': '🌧️',
  '66': '🌨️', '67': '🌨️', '71': '🌨️', '73': '🌨️', '75': '🌨️',
  '77': '🌨️', '80': '🌦️', '81': '🌧️', '82': '🌧️', '85': '🌨️',
  '86': '🌨️', '95': '⛈️', '96': '⛈️', '99': '⛈️'
} as const;

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