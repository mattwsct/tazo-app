// Settings validation utility to prevent malicious entries

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, SETTINGS_CONFIG } from '@/types/settings';



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
      if (expectedType === 'boolean' && typeof value === 'boolean') {
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

  // Log any rejected keys (potential malicious entries)
  for (const key of Object.keys(settings)) {
    if (!(key in SETTINGS_CONFIG)) {
      rejectedKeys.push(key);
    }
  }

  if (rejectedKeys.length > 0) {
    // Check if these are just old chat bot settings that were removed
    const oldChatBotKeys = ['enableChatBot', 'chatBotMessageTemplates', 'chatBotToken', 'kickClientId', 'kickClientSecret'];
    const isOldSettings = rejectedKeys.every(key => oldChatBotKeys.includes(key));
    
    if (isOldSettings) {
      console.log('ℹ️  Ignoring old chat bot settings (removed during cleanup):', rejectedKeys);
    } else {
      console.warn('🚨 Rejected malicious/invalid settings keys:', rejectedKeys);
    }
  }

              // Ensure all required settings are present with defaults
            const completeSettings: OverlaySettings = {
              locationDisplay: cleanSettings.locationDisplay ?? DEFAULT_OVERLAY_SETTINGS.locationDisplay,
      
              showWeather: cleanSettings.showWeather ?? DEFAULT_OVERLAY_SETTINGS.showWeather,
              showMinimap: cleanSettings.showMinimap ?? DEFAULT_OVERLAY_SETTINGS.showMinimap,
              minimapSpeedBased: cleanSettings.minimapSpeedBased ?? DEFAULT_OVERLAY_SETTINGS.minimapSpeedBased,
              showSpeed: cleanSettings.showSpeed ?? DEFAULT_OVERLAY_SETTINGS.showSpeed,
            };

  return completeSettings;
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

  for (const key of Object.keys(settingsObj)) {
    if (!(key in SETTINGS_CONFIG)) {
      maliciousKeys.push(key);
    }
  }

  return maliciousKeys;
} 