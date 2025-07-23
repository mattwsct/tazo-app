// Centralized settings types and constants

export type LocationDisplayMode = 'city' | 'state' | 'country' | 'hidden';

export interface OverlaySettings {
  locationDisplay: LocationDisplayMode;
  showWeather: boolean;
  showMinimap: boolean;
  minimapSpeedBased: boolean;
  showKickSubGoal: boolean;
  kickDailySubGoal: number;
  kickChannelName: string;
  showLatestSub: boolean;
  showSubLeaderboard: boolean;
  kickLeaderboardSize: number;
  enableRollingSubGoal: boolean;
  rollingSubGoalIncrement: number;
  rollingSubGoalDelay: number;
}

// Default settings (single source of truth)
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  locationDisplay: 'city',
  showWeather: true,
  showMinimap: false,
  minimapSpeedBased: false,
  showKickSubGoal: false,
  kickDailySubGoal: 10,
  kickChannelName: 'Tazo', // Hardcoded since it's always Tazo
  showLatestSub: false,
  showSubLeaderboard: false,
  kickLeaderboardSize: 5,
  enableRollingSubGoal: false,
  rollingSubGoalIncrement: 5,
  rollingSubGoalDelay: 5
};

// Valid settings schema for validation
export const SETTINGS_CONFIG: Record<keyof OverlaySettings, 'boolean' | 'string' | 'number'> = {
  locationDisplay: 'string',
  showWeather: 'boolean',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
  showKickSubGoal: 'boolean',
  kickDailySubGoal: 'number',
  kickChannelName: 'string',
  showLatestSub: 'boolean',
  showSubLeaderboard: 'boolean',
  kickLeaderboardSize: 'number',
  enableRollingSubGoal: 'boolean',
  rollingSubGoalIncrement: 'number',
  rollingSubGoalDelay: 'number'
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