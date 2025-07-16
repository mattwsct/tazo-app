// Centralized settings types and constants

export interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
  showSpeed: boolean;
  showTime: boolean;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  showLocation: true,
  showWeather: true,
  showWeatherIcon: true,
  showWeatherCondition: true,
  weatherIconPosition: 'left',
  showSpeed: true,
  showTime: true,
};

// Valid settings schema for validation
export const VALID_SETTINGS_SCHEMA: Record<keyof OverlaySettings, 'boolean' | 'string'> = {
  showLocation: 'boolean',
  showWeather: 'boolean',
  showWeatherIcon: 'boolean',
  showWeatherCondition: 'boolean',
  weatherIconPosition: 'string',
  showSpeed: 'boolean',
  showTime: 'boolean',
};

export const VALID_WEATHER_ICON_POSITIONS = ['left', 'right'] as const;

// SSE message types
export interface SettingsUpdateMessage {
  type: 'settings_update';
  timestamp: number;
  // All OverlaySettings properties will be spread here
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

export type SSEMessage = SettingsUpdateMessage | HeartbeatMessage; 