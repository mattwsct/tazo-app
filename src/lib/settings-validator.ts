// Settings validation utility to prevent malicious entries

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, SETTINGS_CONFIG } from '@/types/settings';

// Valid weather icon positions
const VALID_WEATHER_ICON_POSITIONS: ('left' | 'right')[] = ['left', 'right'];

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
        // Special validation for weatherIconPosition
        if (key === 'weatherIconPosition') {
          if (VALID_WEATHER_ICON_POSITIONS.includes(value as 'left' | 'right')) {
            cleanSettings.weatherIconPosition = value as 'left' | 'right';
          } else {
            console.warn(`Invalid weatherIconPosition: ${value}, defaulting to 'right'`);
            cleanSettings.weatherIconPosition = 'right';
          }
        } else {
          (cleanSettings as Record<string, unknown>)[key] = value;
        }
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
    console.warn('🚨 Rejected malicious/invalid settings keys:', rejectedKeys);
  }

  // Ensure all required settings are present with defaults
  const completeSettings: OverlaySettings = {
    showTime: cleanSettings.showTime ?? DEFAULT_OVERLAY_SETTINGS.showTime,
    showLocation: cleanSettings.showLocation ?? DEFAULT_OVERLAY_SETTINGS.showLocation,
    showWeather: cleanSettings.showWeather ?? DEFAULT_OVERLAY_SETTINGS.showWeather,
    showWeatherIcon: cleanSettings.showWeatherIcon ?? DEFAULT_OVERLAY_SETTINGS.showWeatherIcon,
    showWeatherCondition: cleanSettings.showWeatherCondition ?? DEFAULT_OVERLAY_SETTINGS.showWeatherCondition,
    weatherIconPosition: cleanSettings.weatherIconPosition ?? DEFAULT_OVERLAY_SETTINGS.weatherIconPosition,
    showMinimap: cleanSettings.showMinimap ?? DEFAULT_OVERLAY_SETTINGS.showMinimap,
    minimapSpeedBased: cleanSettings.minimapSpeedBased ?? DEFAULT_OVERLAY_SETTINGS.minimapSpeedBased,
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