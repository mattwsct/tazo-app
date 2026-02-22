// Centralized settings types and constants

/** Single location precision used by overlay, chat, stream title, minimap. Custom = manual overlay text only; hidden = no overlay location. */
export type LocationDisplayMode = 'city' | 'state' | 'country' | 'custom' | 'hidden';
/** Map zoom: match = follow location precision; ocean/continental = special wide views. */
export type MapZoomLevel = 'match' | 'ocean' | 'continental';
export type DisplayMode = 'always' | 'auto' | 'hidden';
export type MinimapTheme = 'auto' | 'light' | 'dark';

import type { PollState } from '@/types/poll';

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
  showSteps: boolean;
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
  /** Master switch: gambling (blackjack) enabled. When false, commands disabled and chips hidden. */
  gamblingEnabled?: boolean;
  /** Top N for gambling leaderboard. */
  gamblingLeaderboardTopN?: number;
  /** Channel point reward title to redeem for chips (exact match, case-insensitive). Empty = disabled. */
  chipRewardTitle?: string;
  /** Chips granted per channel point redemption (when chipRewardTitle matches). */
  chipRewardChips?: number;
  /** Runtime: top chips (from get-settings). */
  gamblingLeaderboardTop?: { username: string; chips: number }[];
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
  locationDisplay: 'city',
  customLocation: '',
  showCountryName: true,
  showWeather: true,
  weatherConditionDisplay: 'auto',
  showMinimap: false,
  minimapSpeedBased: false,
  minimapTheme: 'auto',
  mapZoomLevel: 'match',
  showSteps: true,
  showLeaderboard: true,
  showGoalsRotation: true,
  leaderboardTopN: 5,
  leaderboardExcludedBots: '',
  gamblingEnabled: true,
  gamblingLeaderboardTopN: 5,
  chipRewardTitle: 'Buy Chips',
  chipRewardChips: 50,
  showOverlayAlerts: true,
  showSubGoal: false,
  subGoalTarget: 10, // ~$50 at typical sub price
  subGoalIncrement: 10,
  showKicksGoal: false,
  kicksGoalTarget: 1000, // 1000 kicks = $10
  kicksGoalIncrement: 1000,
};

// Valid settings schema for validation
// Note: 'pollState', 'gamblingLeaderboardTop', 'overlayAlerts', 'streamGoals', 'subGoalCelebrationUntil', 'kicksGoalCelebrationUntil' are runtime, not persisted
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'pollState' | 'gamblingLeaderboardTop' | 'overlayAlerts' | 'streamGoals' | 'subGoalCelebrationUntil' | 'kicksGoalCelebrationUntil'>, 'boolean' | 'string' | 'number'> = {
  locationDisplay: 'string',
  customLocation: 'string',
  showCountryName: 'boolean',
  showWeather: 'boolean',
  weatherConditionDisplay: 'string',
  showMinimap: 'boolean',
  minimapSpeedBased: 'boolean',
  minimapTheme: 'string',
  mapZoomLevel: 'string',
  showSteps: 'boolean',
  showLeaderboard: 'boolean',
  showGoalsRotation: 'boolean',
  leaderboardTopN: 'number',
  leaderboardExcludedBots: 'string',
  gamblingEnabled: 'boolean',
  gamblingLeaderboardTopN: 'number',
  chipRewardTitle: 'string',
  chipRewardChips: 'number',
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