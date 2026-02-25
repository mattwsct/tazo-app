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
  showDistance?: boolean;
  showSpeed?: boolean;
  showAltitude?: boolean;
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
  /** Master switch: gambling enabled. When false, commands disabled and tazos hidden. */
  gamblingEnabled?: boolean;
  /** Top N for gambling leaderboard. */
  gamblingLeaderboardTopN?: number;
  /** Channel point reward title to redeem for tazos (exact match, case-insensitive). Empty = disabled. */
  chipRewardTitle?: string;
  /** Tazos granted per channel point redemption (when chipRewardTitle matches). */
  chipRewardChips?: number;
  /** Auto-start raffles every ~30 min when live. */
  autoRaffleEnabled?: boolean;
  /** Auto tazo drops every ~15 min. */
  chipDropsEnabled?: boolean;
  /** Chat challenges every ~20-30 min. */
  chatChallengesEnabled?: boolean;
  /** Boss events every ~45-60 min. */
  bossEventsEnabled?: boolean;
  /** Win streak bonuses on gambling wins. */
  winStreaksEnabled?: boolean;
  /** Participation streak rewards. */
  participationStreaksEnabled?: boolean;
  /** Tazo rewards for subs, gifts, kicks. */
  subGiftChipRewards?: boolean;
  /** Individual game toggles (all default true, only apply when gamblingEnabled). */
  blackjackEnabled?: boolean;
  slotsEnabled?: boolean;
  rouletteEnabled?: boolean;
  diceEnabled?: boolean;
  crashEnabled?: boolean;
  warEnabled?: boolean;
  coinflipEnabled?: boolean;
  duelEnabled?: boolean;
  heistEnabled?: boolean;
  giftEnabled?: boolean;
  /** Utility command toggles. */
  convertEnabled?: boolean;
  mathEnabled?: boolean;
  /** Runtime: top tazos (from get-settings). */
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
  /** How long the 100% bar shows before auto-incrementing (seconds). */
  goalCelebrationDurationSec?: number;
  /** Runtime: celebration window end (ms) — show 100% until this time. */
  subGoalCelebrationUntil?: number;
  kicksGoalCelebrationUntil?: number;
  /** Runtime: subs and kicks since stream start (from get-settings). */
  streamGoals?: {
    subs: number;
    kicks: number;
    topSubGifter?: { username: string; amount: number };
    topKicksGifter?: { username: string; amount: number };
  };
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
  showDistance: true,
  showSpeed: true,
  showAltitude: true,
  showLeaderboard: true,
  showGoalsRotation: true,
  leaderboardTopN: 5,
  leaderboardExcludedBots: '',
  gamblingEnabled: true,
  gamblingLeaderboardTopN: 5,
  chipRewardTitle: 'Buy Tazos',
  chipRewardChips: 50,
  showOverlayAlerts: true,
  autoRaffleEnabled: true,
  chipDropsEnabled: true,
  chatChallengesEnabled: true,
  bossEventsEnabled: true,
  winStreaksEnabled: true,
  participationStreaksEnabled: true,
  subGiftChipRewards: true,
  blackjackEnabled: true,
  slotsEnabled: true,
  rouletteEnabled: true,
  diceEnabled: true,
  crashEnabled: true,
  warEnabled: true,
  coinflipEnabled: true,
  duelEnabled: true,
  heistEnabled: true,
  giftEnabled: true,
  convertEnabled: true,
  mathEnabled: true,
  showSubGoal: false,
  subGoalTarget: 5,
  subGoalIncrement: 5,
  showKicksGoal: false,
  kicksGoalTarget: 100,
  kicksGoalIncrement: 100,
  goalCelebrationDurationSec: 60,
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
  showDistance: 'boolean',
  showSpeed: 'boolean',
  showAltitude: 'boolean',
  showLeaderboard: 'boolean',
  showGoalsRotation: 'boolean',
  leaderboardTopN: 'number',
  leaderboardExcludedBots: 'string',
  gamblingEnabled: 'boolean',
  gamblingLeaderboardTopN: 'number',
  chipRewardTitle: 'string',
  chipRewardChips: 'number',
  autoRaffleEnabled: 'boolean',
  chipDropsEnabled: 'boolean',
  chatChallengesEnabled: 'boolean',
  bossEventsEnabled: 'boolean',
  winStreaksEnabled: 'boolean',
  participationStreaksEnabled: 'boolean',
  subGiftChipRewards: 'boolean',
  blackjackEnabled: 'boolean',
  slotsEnabled: 'boolean',
  rouletteEnabled: 'boolean',
  diceEnabled: 'boolean',
  crashEnabled: 'boolean',
  warEnabled: 'boolean',
  coinflipEnabled: 'boolean',
  duelEnabled: 'boolean',
  heistEnabled: 'boolean',
  giftEnabled: 'boolean',
  convertEnabled: 'boolean',
  mathEnabled: 'boolean',
  showOverlayAlerts: 'boolean',
  showSubGoal: 'boolean',
  subGoalTarget: 'number',
  subGoalIncrement: 'number',
  subGoalSubtext: 'string',
  showKicksGoal: 'boolean',
  kicksGoalTarget: 'number',
  kicksGoalIncrement: 'number',
  kicksGoalSubtext: 'string',
  goalCelebrationDurationSec: 'number',
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