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
  showActiveCalories?: boolean;
  showFlights?: boolean;
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
  /** Boss events every ~45-60 min. */
  bossEventsEnabled?: boolean;
  /** Auto streamer polls (random question with 5 boss names as options) in auto-game rotation. */
  autoPollEnabled?: boolean;
  /** Master switch: enable all auto games (raffle/drops/boss/polls). Default true. */
  autoGamesEnabled?: boolean;
  /** Minutes to wait after a game ends before starting the next. Default 5. */
  autoGameIntervalMin?: number;
  /** Win streak bonuses on gambling wins. */
  winStreaksEnabled?: boolean;
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
  /** Show top sub gifter on sub goal progress bar. */
  showTopSubGifter?: boolean;
  /** Kicks goal: show progress bar, target (in kicks). */
  showKicksGoal?: boolean;
  kicksGoalTarget?: number;
  /** Amount to add to kicks goal when reached (auto-increment). */
  kicksGoalIncrement?: number;
  /** Optional second line for kicks goal */
  kicksGoalSubtext?: string;
  /** Show top kicks gifter on kicks goal progress bar. */
  showTopKicksGifter?: boolean;
  /** IANA timezone for weekly/monthly leaderboard resets (e.g. "Asia/Bangkok"). */
  streamerTimezone?: string;
  /** Show individual earned leaderboard periods in overlay rotation. */
  showWeeklyEarnedLb?: boolean;
  showMonthlyEarnedLb?: boolean;
  showLifetimeEarnedLb?: boolean;
  /** Seconds each leaderboard slide is shown before crossfading to the next. Default 15. */
  leaderboardRotationSec?: number;
  /** Runtime: earned leaderboard data (weekly/monthly/lifetime). */
  earnedLeaderboardWeekly?: { username: string; earned: number }[];
  earnedLeaderboardMonthly?: { username: string; earned: number }[];
  earnedLeaderboardLifetime?: { username: string; earned: number }[];
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
  showActiveCalories: true,
  showFlights: true,
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
  bossEventsEnabled: true,
  autoPollEnabled: true,
  autoGamesEnabled: true,
  autoGameIntervalMin: 5,
  winStreaksEnabled: true,
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
  showTopSubGifter: true,
  showKicksGoal: false,
  kicksGoalTarget: 100,
  kicksGoalIncrement: 100,
  showTopKicksGifter: true,
  streamerTimezone: 'UTC',
  showWeeklyEarnedLb: true,
  showMonthlyEarnedLb: true,
  showLifetimeEarnedLb: true,
  leaderboardRotationSec: 15,
};

// Valid settings schema for validation
// Note: runtime fields are not persisted to KV
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'pollState' | 'gamblingLeaderboardTop' | 'overlayAlerts' | 'streamGoals' | 'subGoalCelebrationUntil' | 'kicksGoalCelebrationUntil' | 'earnedLeaderboardWeekly' | 'earnedLeaderboardMonthly' | 'earnedLeaderboardLifetime'>, 'boolean' | 'string' | 'number'> = {
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
  showActiveCalories: 'boolean',
  showFlights: 'boolean',
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
  bossEventsEnabled: 'boolean',
  autoPollEnabled: 'boolean',
  autoGamesEnabled: 'boolean',
  autoGameIntervalMin: 'number',
  winStreaksEnabled: 'boolean',
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
  showTopSubGifter: 'boolean',
  showKicksGoal: 'boolean',
  kicksGoalTarget: 'number',
  kicksGoalIncrement: 'number',
  kicksGoalSubtext: 'string',
  showTopKicksGifter: 'boolean',
  streamerTimezone: 'string',
  showWeeklyEarnedLb: 'boolean',
  showMonthlyEarnedLb: 'boolean',
  showLifetimeEarnedLb: 'boolean',
  leaderboardRotationSec: 'number',
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