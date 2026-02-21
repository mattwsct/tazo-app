// Centralized settings types and constants

export type LocationDisplayMode = 'neighbourhood' | 'city' | 'state' | 'country' | 'custom' | 'hidden';
/** Max level when broadening stale GPS: city = never go beyond city; state = never country-only; country = allow country-only */
export type LocationStaleMaxFallback = 'city' | 'state' | 'country';
export type MapZoomLevel = 'neighbourhood' | 'city' | 'state' | 'country' | 'ocean' | 'continental';
export type DisplayMode = 'always' | 'auto' | 'hidden';
export type MinimapTheme = 'auto' | 'light' | 'dark';

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
  showSteps: boolean;
  showDistance: boolean;
  showDistanceMiles: boolean;
  /** Chat poll state (from Kick). Not persisted in settings. */
  pollState?: PollState | null;
  /** Leaderboard: include in rotation (true) or hidden (false). */
  showLeaderboard?: boolean;
  /** When false, hide the rotating carousel — alerts still pop up in goal bars when they fire. */
  showGoalsRotation?: boolean;
  leaderboardTopN?: number;
  /** Comma or newline-separated usernames to exclude from leaderboard (e.g. bots, your own name). */
  leaderboardExcludedBots?: string;
  showOverlayAlerts?: boolean;
  /** Runtime: top leaderboard entries (from get-settings). */
  leaderboardTop?: { username: string; points: number }[];
  /** Runtime: recent overlay alerts (from get-settings). */
  overlayAlerts?: { id: string; type: string; username: string; extra?: string; at: number }[];
  /** Sub goal: show progress bar, target count. */
  showSubGoal?: boolean;
  subGoalTarget?: number;
  /** Amount to add to sub goal when reached (auto-increment). */
  subGoalIncrement?: number;
  /** Optional second line for sub goal (e.g. "10 subs = 10 min extra!") */
  subGoalSubtext?: string;
  /** Kicks goal: show progress bar, target (in kicks). */
  showKicksGoal?: boolean;
  kicksGoalTarget?: number;
  /** Amount to add to kicks goal when reached (auto-increment). */
  kicksGoalIncrement?: number;
  /** Optional second line for kicks goal */
  kicksGoalSubtext?: string;
  /** Runtime: celebration window end (ms) — show 100% until this time. */
  subGoalCelebrationUntil?: number;
  kicksGoalCelebrationUntil?: number;
  /** Runtime: subs and kicks since stream start (from get-settings). */
  streamGoals?: { subs: number; kicks: number };
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
  showSteps: true,
  showDistance: true,
  showDistanceMiles: true,
  showLeaderboard: true,
  showGoalsRotation: true,
  leaderboardTopN: 5,
  leaderboardExcludedBots: '',
  showOverlayAlerts: true,
  showSubGoal: false,
  subGoalTarget: 10, // ~$50 at typical sub price
  subGoalIncrement: 10,
  showKicksGoal: false,
  kicksGoalTarget: 1000, // 1000 kicks = $10
  kicksGoalIncrement: 1000,
};

// Valid settings schema for validation
// Note: 'pollState', 'leaderboardTop', 'overlayAlerts', 'streamGoals', 'subGoalCelebrationUntil', 'kicksGoalCelebrationUntil' are runtime, not persisted
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'pollState' | 'leaderboardTop' | 'overlayAlerts' | 'streamGoals' | 'subGoalCelebrationUntil' | 'kicksGoalCelebrationUntil'>, 'boolean' | 'string' | 'number'> = {
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
  showSteps: 'boolean',
  showDistance: 'boolean',
  showDistanceMiles: 'boolean',
  showLeaderboard: 'boolean',
  showGoalsRotation: 'boolean',
  leaderboardTopN: 'number',
  leaderboardExcludedBots: 'string',
  showOverlayAlerts: 'boolean',
  showSubGoal: 'boolean',
  subGoalTarget: 'number',
  subGoalIncrement: 'number',
  subGoalSubtext: 'string',
  showKicksGoal: 'boolean',
  kicksGoalTarget: 'number',
  kicksGoalIncrement: 'number',
  kicksGoalSubtext: 'string',
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