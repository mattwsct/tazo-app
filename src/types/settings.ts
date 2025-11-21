// Centralized settings types and constants

export type LocationDisplayMode = 'neighborhood' | 'city' | 'country' | 'custom' | 'hidden';
export type MapZoomLevel = 'neighborhood' | 'city' | 'regional' | 'national' | 'ocean' | 'continental';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface OverlaySettings {
  locationDisplay: LocationDisplayMode;
  customLocation?: string;
  showCountryName: boolean;
  showWeather: boolean;
  showMinimap: boolean;
  minimapSpeedBased: boolean;
  mapZoomLevel: MapZoomLevel;
  todos?: TodoItem[];
  showTodoList?: boolean;
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
  todos: [],
  showTodoList: false,
};

// Valid settings schema for validation
// Note: 'todos' is handled separately in the validator as it's an array
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'todos'>, 'boolean' | 'string' | 'number'> = {
  locationDisplay: 'string',
  customLocation: 'string',
  showCountryName: 'boolean',
  showWeather: 'boolean',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
  mapZoomLevel: 'string',
  showTodoList: 'boolean'
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