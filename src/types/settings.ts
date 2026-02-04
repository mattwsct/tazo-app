// Centralized settings types and constants

export type LocationDisplayMode = 'neighbourhood' | 'city' | 'state' | 'country' | 'custom' | 'hidden';
export type MapZoomLevel = 'neighbourhood' | 'city' | 'state' | 'country' | 'ocean' | 'continental';
export type DisplayMode = 'always' | 'auto' | 'hidden';
export type MinimapTheme = 'auto' | 'light' | 'dark';

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
  weatherConditionDisplay: DisplayMode;
  showMinimap: boolean;
  minimapSpeedBased: boolean;
  minimapTheme: MinimapTheme;
  mapZoomLevel: MapZoomLevel;
  altitudeDisplay: DisplayMode;
  speedDisplay: DisplayMode;
  todos?: TodoItem[];
  showTodoList?: boolean;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  locationDisplay: 'neighbourhood',
  customLocation: '',
  showCountryName: true,
  showWeather: true,
  weatherConditionDisplay: 'auto',
  showMinimap: false,
  minimapSpeedBased: false,
  minimapTheme: 'auto',
  mapZoomLevel: 'city',
  altitudeDisplay: 'auto',
  speedDisplay: 'auto',
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
  weatherConditionDisplay: 'string',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
  minimapTheme: 'string',
  mapZoomLevel: 'string',
  altitudeDisplay: 'string',
  speedDisplay: 'string',
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