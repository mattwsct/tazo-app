// Centralized settings types and constants

export type LocationDisplayMode = 'neighbourhood' | 'city' | 'state' | 'country' | 'custom' | 'hidden';
/** Max level when broadening stale GPS: city = never go beyond city; state = never country-only; country = allow country-only */
export type LocationStaleMaxFallback = 'city' | 'state' | 'country';
export type MapZoomLevel = 'neighbourhood' | 'city' | 'state' | 'country' | 'ocean' | 'continental';
export type DisplayMode = 'always' | 'auto' | 'hidden';
export type MinimapTheme = 'auto' | 'light' | 'dark';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

import type { PollState } from '@/types/poll';

export interface OverlaySettings {
  locationDisplay: LocationDisplayMode;
  /** When true (default), broaden location when GPS is stale. When false, always use selected display mode. */
  broadenLocationWhenStale?: boolean;
  /** When broadening, never go beyond this level. State = always show state+country; country = allow country-only. */
  locationStaleMaxFallback?: LocationStaleMaxFallback;
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
  /** Chat poll state (from Kick). Not persisted in settings. */
  pollState?: PollState | null;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  locationDisplay: 'neighbourhood',
  broadenLocationWhenStale: true,
  locationStaleMaxFallback: 'country',
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
// Note: 'todos' is handled separately; 'pollState' is runtime from SSE, not persisted
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'todos' | 'pollState'>, 'boolean' | 'string' | 'number'> = {
  locationDisplay: 'string',
  broadenLocationWhenStale: 'boolean',
  locationStaleMaxFallback: 'string',
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