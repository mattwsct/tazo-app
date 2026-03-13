// Centralized settings types and constants

/** Single location precision used by overlay, chat, stream title, minimap. Custom = manual overlay text only; hidden = no overlay location. */
export type LocationDisplayMode = 'city' | 'state' | 'country' | 'custom' | 'hidden';
/** Map zoom: match = follow location precision; ocean/continental = special wide views. */
export type MapZoomLevel = 'match' | 'ocean' | 'continental';
export type DisplayMode = 'always' | 'auto' | 'hidden';
export type MinimapTheme = 'auto' | 'light' | 'dark';

import type { PollState } from '@/types/poll';
import type { TriviaState } from '@/types/trivia';
import type { OverlayTimerState } from '@/types/timer';
import type { ChallengesState, WalletState } from '@/types/challenges';

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
  /** Trivia (first-to-answer) state. Not persisted in overlay_settings. */
  triviaState?: TriviaState | null;
  /** @deprecated Phase 1: leaderboards removed. Kept for KV compat. */
  showLeaderboard?: boolean;
  /** When false, hide the rotating carousel — alerts still pop up in goal bars when they fire. */
  showGoalsRotation?: boolean;
  /** @deprecated Phase 1: leaderboards removed. Kept for KV compat. */
  leaderboardTopN?: number;
  /** Comma or newline-separated usernames to exclude from earning Credits (e.g. bots). */
  leaderboardExcludedBots?: string;
  showOverlayAlerts?: boolean;
  /** Master switch: Credits & blackjack enabled. */
  gamblingEnabled?: boolean;
  /** @deprecated Phase 1: leaderboards removed. Kept for KV compat. */
  gamblingLeaderboardTopN?: number;
  /** Channel reward 1: exact reward title that grants 50 Credits (e.g. "Buy 50 Credits"). */
  chipRewardTitle?: string;
  /** Channel reward 2: exact reward title that grants 500 Credits (e.g. "Buy 500 Credits"). */
  chipRewardTitle2?: string;
  /** @deprecated Credits per redemption now hardcoded (50 / 500). Kept for KV compat. */
  chipRewardChips?: number;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  autoRaffleEnabled?: boolean;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  chipDropsEnabled?: boolean;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  bossEventsEnabled?: boolean;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  autoPollEnabled?: boolean;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  autoGamesEnabled?: boolean;
  /** @deprecated Phase 1: auto events removed. Kept for KV compat. */
  autoGameIntervalMin?: number;
  /** @deprecated Win streak bonuses — feature removed, kept for KV backwards compat. */
  winStreaksEnabled?: boolean;
  /** @deprecated Tazo rewards for subs/gifts/kicks — feature removed, kept for KV backwards compat. */
  subGiftChipRewards?: boolean;
  /** Blackjack (!bj / !deal). */
  blackjackEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  slotsEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  rouletteEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  diceEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  crashEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  warEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  coinflipEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  duelEnabled?: boolean;
  /** @deprecated Phase 1: removed. Kept for KV compat. */
  heistEnabled?: boolean;
  /** @deprecated Phase 1: !give removed. Kept for KV compat. */
  giftEnabled?: boolean;
  /** Utility command toggles. */
  convertEnabled?: boolean;
  mathEnabled?: boolean;
  /** Runtime: top Credits (from get-settings). Used for overlay and chat !leaderboard. */
  gamblingLeaderboardTop?: { username: string; chips: number }[];
  /** Runtime: recent overlay alerts (from get-settings). */
  overlayAlerts?: { id: string; type: string; username: string; extra?: string; at: number }[];
  /** Sub goal: show progress bar, target count. Also controls sub count in stream title. */
  showSubGoal?: boolean;
  subGoalTarget?: number;
  /** Amount to add to sub goal when reached (auto-increment). */
  subGoalIncrement?: number;
  /** Optional second line for sub goal — when set, goal is fixed (no auto-iterate). */
  subGoalSubtext?: string;
  /** Kicks goal: show progress bar, target (in kicks). */
  showKicksGoal?: boolean;
  kicksGoalTarget?: number;
  /** Amount to add to kicks goal when reached (auto-increment). */
  kicksGoalIncrement?: number;
  /** Optional second line for kicks goal — when set, goal is fixed (no auto-iterate). */
  kicksGoalSubtext?: string;
  /** @deprecated Phase 1: earned leaderboards removed. Kept for KV compat. */
  streamerTimezone?: string;
  /** @deprecated Phase 1: earned leaderboards removed. Kept for KV compat. */
  showWeeklyEarnedLb?: boolean;
  /** @deprecated Phase 1: earned leaderboards removed. Kept for KV compat. */
  showMonthlyEarnedLb?: boolean;
  /** @deprecated Phase 1: earned leaderboards removed. Kept for KV compat. */
  showLifetimeEarnedLb?: boolean;
  /** @deprecated Phase 1: leaderboards removed. Kept for KV compat. */
  leaderboardRotationSec?: number;
  /** Runtime: earned leaderboard data. @deprecated Phase 1: no longer sent. */
  earnedLeaderboardWeekly?: { username: string; earned: number }[];
  earnedLeaderboardMonthly?: { username: string; earned: number }[];
  earnedLeaderboardLifetime?: { username: string; earned: number }[];
  /** Runtime: subs and kicks since stream start (from get-settings). */
  streamGoals?: {
    subs: number;
    kicks: number;
  };
  /** Wallet: show balance on overlay and auto-increment on subs/kicks. */
  walletEnabled?: boolean;
  /** Hide wallet row from overlay without disabling accumulation. Default: true (visible). */
  walletVisible?: boolean;
  /** Hide challenges section from overlay without stopping challenge commands. Default: true (visible). */
  challengesVisible?: boolean;
  /** Starting wallet balance when stream resets (USD). Default: 15. */
  walletStartingBalance?: number;
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
  chipRewardTitle: 'Buy 50 Credits',
  chipRewardTitle2: 'Buy 500 Credits',
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
  showKicksGoal: false,
  walletEnabled: false,
  walletStartingBalance: 15,
  kicksGoalTarget: 5000,
  kicksGoalIncrement: 5000,
  streamerTimezone: 'UTC',
  showWeeklyEarnedLb: true,
  showMonthlyEarnedLb: true,
  showLifetimeEarnedLb: true,
  leaderboardRotationSec: 10,
};

// Valid settings schema for validation
// Note: runtime fields are not persisted to KV
export const SETTINGS_CONFIG: Record<Exclude<keyof OverlaySettings, 'pollState' | 'triviaState' | 'gamblingLeaderboardTop' | 'overlayAlerts' | 'streamGoals' | 'earnedLeaderboardWeekly' | 'earnedLeaderboardMonthly' | 'earnedLeaderboardLifetime'>, 'boolean' | 'string' | 'number'> = {
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
  chipRewardTitle2: 'string',
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
  showKicksGoal: 'boolean',
  kicksGoalTarget: 'number',
  kicksGoalIncrement: 'number',
  kicksGoalSubtext: 'string',
  walletEnabled: 'boolean',
  walletVisible: 'boolean',
  challengesVisible: 'boolean',
  walletStartingBalance: 'number',
  streamerTimezone: 'string',
  showWeeklyEarnedLb: 'boolean',
  showMonthlyEarnedLb: 'boolean',
  showLifetimeEarnedLb: 'boolean',
  leaderboardRotationSec: 'number',
};

/**
 * Runtime-only overlay state — never stored to KV, computed/fetched at runtime.
 * Used by get-settings endpoint and overlay page to combine persisted + live data.
 */
export interface OverlayRuntimeState {
  pollState?: import('@/types/poll').PollState | null;
  triviaState?: import('@/types/trivia').TriviaState | null;
  streamGoals?: { subs: number; kicks: number };
  gamblingLeaderboardTop?: { username: string; chips: number }[];
  overlayAlerts?: { id: string; type: string; username: string; extra?: string; at: number }[];
  earnedLeaderboardWeekly?: { username: string; earned: number }[];
  earnedLeaderboardMonthly?: { username: string; earned: number }[];
  earnedLeaderboardLifetime?: { username: string; earned: number }[];
  /** Runtime-only overlay timer state (countdown). */
  timerState?: OverlayTimerState | null;
  /** Runtime: current challenges list and wallet balance. */
  challengesState?: ChallengesState | null;
  walletState?: WalletState | null;
}

/**
 * Combined persisted + runtime state — used by overlay page and get-settings endpoint.
 */
export type OverlayState = OverlaySettings & OverlayRuntimeState;

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