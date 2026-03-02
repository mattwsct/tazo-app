// Settings validation utility to prevent malicious entries

import { OverlaySettings, SETTINGS_CONFIG } from '@/types/settings';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';



/**
 * Validates and sanitizes settings object
 * Removes any malicious or unknown properties
 */
export function validateAndSanitizeSettings(input: unknown): OverlaySettings {
  if (!input || typeof input !== 'object') {
    throw new Error('Settings must be an object');
  }

  const settings = input as Record<string, unknown>;
  const cleanSettings: Partial<OverlaySettings> = {};
  const rejectedKeys: string[] = [];

  // Validate each field according to schema
  for (const [key, expectedType] of Object.entries(SETTINGS_CONFIG)) {
    const value = settings[key];
    
    if (value !== undefined) {
      if (value === null) {
        // null is a valid "clear this field" value — pass it through as-is
        (cleanSettings as Record<string, unknown>)[key] = null;
      } else if (expectedType === 'boolean' && typeof value === 'boolean') {
        (cleanSettings as Record<string, unknown>)[key] = value;
      } else if (expectedType === 'string' && typeof value === 'string') {
        (cleanSettings as Record<string, unknown>)[key] = value;
      } else if (expectedType === 'number' && typeof value === 'number') {
        (cleanSettings as Record<string, unknown>)[key] = value;
      } else {
        console.warn(`Invalid type for ${key}: expected ${expectedType}, got ${typeof value}`);
        rejectedKeys.push(key);
      }
    }
  }

  // Migrate legacy leaderboardDisplay -> showLeaderboard
  const legacy = settings as { leaderboardDisplay?: string; showLeaderboard?: boolean };
  if (settings.showLeaderboard === undefined && legacy.leaderboardDisplay !== undefined) {
    (cleanSettings as Record<string, unknown>).showLeaderboard = legacy.leaderboardDisplay !== 'hidden';
  }

  // Log any rejected keys (potential malicious entries)
  // These are runtime-only fields — not persisted but valid to receive from the client
  const allowedNonSchema = [
    'pollState',
    'gamblingLeaderboardTop',
    'earnedLeaderboardWeekly',
    'earnedLeaderboardMonthly',
    'earnedLeaderboardLifetime',
    'overlayAlerts',
    'streamGoals',
  ];
  for (const key of Object.keys(settings)) {
    if (!(key in SETTINGS_CONFIG) && !allowedNonSchema.includes(key)) {
      rejectedKeys.push(key);
    }
  }

  if (rejectedKeys.length > 0) {
    // Check if these are just old chat bot settings that were removed
    const deprecatedChatBotKeys = [
      'enableChatBot', 'chatBotMessageTemplates', 'chatBotToken', 'kickClientId', 'kickClientSecret',
      // Removed settings — still present in old KV data, safe to silently drop
      'showSubCountInTitle', 'showTopSubGifter', 'showTopKicksGifter',
      'subGoalCelebrationUntil', 'kicksGoalCelebrationUntil',
    ];
    const isDeprecatedSettings = rejectedKeys.every(key => deprecatedChatBotKeys.includes(key));
    
    if (isDeprecatedSettings) {
      console.log('ℹ️  Ignoring old chat bot settings (removed during cleanup):', rejectedKeys);
    } else {
      console.warn('🚨 Rejected malicious/invalid settings keys:', rejectedKeys);
    }
  }

  return mergeSettingsWithDefaults(cleanSettings);
}

/**
 * Check if settings object contains any suspicious keys
 */
export function detectMaliciousKeys(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object') {
    return [];
  }

  const maliciousKeys: string[] = [];
  const settingsObj = settings as Record<string, unknown>;

  const ignoredKeys = [
    // Runtime-only (never persisted)
    'pollState', 'gamblingLeaderboardTop', 'earnedLeaderboardWeekly',
    'earnedLeaderboardMonthly', 'earnedLeaderboardLifetime', 'overlayAlerts', 'streamGoals',
    // Removed settings — stale KV data, not malicious
    'showSubCountInTitle', 'showTopSubGifter', 'showTopKicksGifter',
    'subGoalCelebrationUntil', 'kicksGoalCelebrationUntil',
  ];
  for (const key of Object.keys(settingsObj)) {
    if (!(key in SETTINGS_CONFIG) && !ignoredKeys.includes(key)) {
      maliciousKeys.push(key);
    }
  }

  return maliciousKeys;
} 