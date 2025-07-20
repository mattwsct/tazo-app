// Centralized settings types and constants

export type LocationDisplayMode = 'city' | 'state' | 'country' | 'hidden';

export interface OverlaySettings {
  locationDisplay: LocationDisplayMode;
  showWeather: boolean;
  showMinimap: boolean;
  minimapSpeedBased: boolean;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  locationDisplay: 'city',
  showWeather: true,
  showMinimap: false,
  minimapSpeedBased: false,
};

// Valid settings schema for validation
export const SETTINGS_CONFIG: Record<keyof OverlaySettings, 'boolean' | 'string'> = {
  locationDisplay: 'string',
  showWeather: 'boolean',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
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