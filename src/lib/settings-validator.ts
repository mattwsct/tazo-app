// Settings validation utility to prevent malicious entries

export interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
  showSpeed: boolean;
  showTime: boolean;
}

// Define valid settings schema
const VALID_SETTINGS_SCHEMA: Record<keyof OverlaySettings, 'boolean' | 'string'> = {
  showLocation: 'boolean',
  showWeather: 'boolean',
  showWeatherIcon: 'boolean',
  showWeatherCondition: 'boolean',
  weatherIconPosition: 'string',
  showSpeed: 'boolean',
  showTime: 'boolean',
};

const VALID_WEATHER_ICON_POSITIONS = ['left', 'right'] as const;

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

  // Validate each known setting
  for (const [key, expectedType] of Object.entries(VALID_SETTINGS_SCHEMA)) {
    const value = settings[key];
    
    if (value !== undefined) {
      if (expectedType === 'boolean' && typeof value === 'boolean') {
        (cleanSettings as any)[key] = value;
      } else if (expectedType === 'string' && typeof value === 'string') {
        // Special validation for weatherIconPosition
        if (key === 'weatherIconPosition') {
          if (VALID_WEATHER_ICON_POSITIONS.includes(value as any)) {
            cleanSettings.weatherIconPosition = value as 'left' | 'right';
          } else {
            console.warn(`Invalid weatherIconPosition: ${value}, defaulting to 'left'`);
            cleanSettings.weatherIconPosition = 'left';
          }
        } else {
          (cleanSettings as any)[key] = value;
        }
      } else {
        console.warn(`Invalid type for ${key}: expected ${expectedType}, got ${typeof value}`);
        rejectedKeys.push(key);
      }
    }
  }

  // Log any rejected keys (potential malicious entries)
  for (const key of Object.keys(settings)) {
    if (!(key in VALID_SETTINGS_SCHEMA)) {
      rejectedKeys.push(key);
    }
  }

  if (rejectedKeys.length > 0) {
    console.warn('🚨 Rejected malicious/invalid settings keys:', rejectedKeys);
  }

  // Ensure all required settings are present with defaults
  const completeSettings: OverlaySettings = {
    showLocation: cleanSettings.showLocation ?? true,
    showWeather: cleanSettings.showWeather ?? true,
    showWeatherIcon: cleanSettings.showWeatherIcon ?? true,
    showWeatherCondition: cleanSettings.showWeatherCondition ?? true,
    weatherIconPosition: cleanSettings.weatherIconPosition ?? 'left',
    showSpeed: cleanSettings.showSpeed ?? true,
    showTime: cleanSettings.showTime ?? true,
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
    if (!(key in VALID_SETTINGS_SCHEMA)) {
      maliciousKeys.push(key);
    }
  }

  return maliciousKeys;
} 