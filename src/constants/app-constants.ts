// === 🎯 APPLICATION CONSTANTS ===

// API Configuration
export const API_CONSTANTS = {
  TIMEOUT: 10000, // 10 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000, // 1 second base delay
  MAX_RETRY_DELAY: 10000, // 10 seconds max delay
  COOLDOWN: 300000, // 5 minutes between API calls
} as const;

// Timer Configuration
export const TIMER_CONSTANTS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes
  LOCATION_UPDATE: 300000, // 5 minutes
  OVERLAY_FADE_TIMEOUT: 5000, // 5 seconds to force fade-in
  MINIMAP_HIDE_DELAY: 120000, // 2 minutes - hide minimap if no GPS data
  SPEED_HIDE_DELAY: 10000, // 10 seconds - hide speed when below threshold
  POLLING_INTERVAL: 600000, // 10 minutes for settings polling
  HEART_RATE_TIMEOUT: 10000, // 10 seconds - hide if no data
  ANIMATION_DELAY: 1000, // 1 second delay before updating animation speed
  STEP_DURATION: 100, // ms per step (2 seconds total)
  INIT_DELAY: 1000, // 1 second delay for initialization
} as const;

// Threshold Configuration
export const THRESHOLD_CONSTANTS = {
  LOCATION_DISTANCE: 100, // 100 meters
  SPEED_SHOW: 10, // 10 km/h - show speed-based minimap
  SPEED_READINGS_REQUIRED: 3, // 3 successive readings above threshold
  HEART_RATE_CHANGE: 5, // 5 BPM - minimum change to update animation
  TRANSITION_STEPS: 20, // Number of smooth transition steps
  MAX_COUNTRY_NAME_LENGTH: 12, // Maximum character length for country names
  MAX_RECONNECT_ATTEMPTS: 10, // Maximum reconnection attempts
  SSE_RECONNECT_BASE_DELAY: 1000, // Base delay for SSE reconnection
  SSE_RECONNECT_MAX_DELAY: 30000, // Maximum delay for SSE reconnection
  SSE_RECONNECT_EXPONENT: 2, // Exponential backoff exponent
  SSE_MAX_RECONNECT_ATTEMPTS: 5, // Maximum SSE reconnection attempts before polling
} as const;

// Heart Rate Zones
export const HEART_RATE_ZONES = {
  NEUTRAL: { min: 0, max: 40, color: '#808080', name: 'Neutral' },
  RESTING: { min: 40, max: 60, color: '#87CEEB', name: 'Resting' },
  NORMAL: { min: 60, max: 100, color: '#FFFFFF', name: 'Normal' },
  ELEVATED: { min: 100, max: 120, color: '#FFFF99', name: 'Elevated' },
  HIGH: { min: 120, max: 140, color: '#FFA500', name: 'High' },
  VERY_HIGH: { min: 140, max: 200, color: '#FF0000', name: 'Very High' },
} as const;

// Performance Thresholds
export const PERFORMANCE_CONSTANTS = {
  SLOW_OPERATION_THRESHOLD: 1000, // 1 second - warn for slow operations
  SLOW_RENDER_THRESHOLD: 16, // 16ms - warn for slow renders (60fps target)
  FREQUENT_RENDER_THRESHOLD: 10, // 10 renders - warn for frequent re-renders
  FREQUENT_RENDER_WINDOW: 5000, // 5 seconds - window for frequent render detection
} as const;

// Toast Configuration
export const TOAST_CONSTANTS = {
  SUCCESS_DURATION: 1500, // 1.5 seconds for success messages
  ERROR_DURATION: 3000, // 3 seconds for error messages
} as const;

// Cache Configuration
export const CACHE_CONSTANTS = {
  DEFAULT_TTL: 300000, // 5 minutes default TTL
  WEATHER_TTL: 300000, // 5 minutes for weather data
  LOCATION_TTL: 600000, // 10 minutes for location data
  SETTINGS_TTL: 60000, // 1 minute for settings data
} as const; 