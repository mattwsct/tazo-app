// Centralized settings types and constants

export type LocationDisplayMode = 'neighborhood' | 'city' | 'custom' | 'hidden';
export type MapZoomLevel = 'street' | 'city' | 'region' | 'country';

export interface OverlaySettings {
  locationDisplay: LocationDisplayMode;
  customLocation?: string;
  showCountryName: boolean;
  showWeather: boolean;
  showMinimap: boolean;
  minimapSpeedBased: boolean;
  mapZoomLevel: MapZoomLevel;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  locationDisplay: 'neighborhood',
  customLocation: '',
  showCountryName: true,
  showWeather: true,
  showMinimap: false,
  minimapSpeedBased: false,
  mapZoomLevel: 'city',
};

// Valid settings schema for validation
export const SETTINGS_CONFIG: Record<keyof OverlaySettings, 'boolean' | 'string' | 'number'> = {
  locationDisplay: 'string',
  customLocation: 'string',
  showCountryName: 'boolean',
  showWeather: 'boolean',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
  mapZoomLevel: 'string'
};

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