// Centralized settings types and constants

export interface OverlaySettings {
  showTime: boolean;
  showLocation: boolean;
  showWeather: boolean;
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
  showMinimap: boolean;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  showTime: true,
  showLocation: true,
  showWeather: true,
  showWeatherIcon: true,
  showWeatherCondition: true,
  weatherIconPosition: 'right',
  showMinimap: false,
};

// Valid settings schema for validation
export const SETTINGS_CONFIG: Record<keyof OverlaySettings, 'boolean' | 'string'> = {
  showTime: 'boolean',
  showLocation: 'boolean',
  showWeather: 'boolean',
  showWeatherIcon: 'boolean',
  showWeatherCondition: 'boolean',
  weatherIconPosition: 'string',
  showMinimap: 'boolean',
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