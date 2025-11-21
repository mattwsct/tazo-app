// Settings validation utility to prevent malicious entries

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, SETTINGS_CONFIG, TodoItem } from '@/types/settings';



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

  // Validate todos array (special handling)
  if (settings.todos !== undefined) {
    if (Array.isArray(settings.todos)) {
      const validTodos: TodoItem[] = [];
      for (const todo of settings.todos) {
        if (todo && typeof todo === 'object' && 'id' in todo && 'text' in todo && 'completed' in todo) {
          const todoObj = todo as Record<string, unknown>;
          if (typeof todoObj.id === 'string' && typeof todoObj.text === 'string' && typeof todoObj.completed === 'boolean') {
            validTodos.push({
              id: todoObj.id,
              text: String(todoObj.text).slice(0, 200), // Limit text length
              completed: Boolean(todoObj.completed)
            });
          }
        }
      }
      cleanSettings.todos = validTodos;
    } else {
      console.warn('Invalid type for todos: expected array');
      rejectedKeys.push('todos');
    }
  }

  // Log any rejected keys (potential malicious entries)
  for (const key of Object.keys(settings)) {
    if (!(key in SETTINGS_CONFIG) && key !== 'todos') { // todos is handled separately
      rejectedKeys.push(key);
    }
  }

  if (rejectedKeys.length > 0) {
    // Check if these are just old chat bot settings that were removed
    const deprecatedChatBotKeys = ['enableChatBot', 'chatBotMessageTemplates', 'chatBotToken', 'kickClientId', 'kickClientSecret'];
    const isDeprecatedSettings = rejectedKeys.every(key => deprecatedChatBotKeys.includes(key));
    
    if (isDeprecatedSettings) {
      console.log('ℹ️  Ignoring old chat bot settings (removed during cleanup):', rejectedKeys);
    } else {
      console.warn('🚨 Rejected malicious/invalid settings keys:', rejectedKeys);
    }
  }

              // Ensure all required settings are present with defaults
            const completeSettings: OverlaySettings = {
              locationDisplay: cleanSettings.locationDisplay ?? DEFAULT_OVERLAY_SETTINGS.locationDisplay,
              customLocation: cleanSettings.customLocation ?? DEFAULT_OVERLAY_SETTINGS.customLocation,
              showCountryName: cleanSettings.showCountryName ?? DEFAULT_OVERLAY_SETTINGS.showCountryName,
              showWeather: cleanSettings.showWeather ?? DEFAULT_OVERLAY_SETTINGS.showWeather,
              showMinimap: cleanSettings.showMinimap ?? DEFAULT_OVERLAY_SETTINGS.showMinimap,
              minimapSpeedBased: cleanSettings.minimapSpeedBased ?? DEFAULT_OVERLAY_SETTINGS.minimapSpeedBased,
              mapZoomLevel: cleanSettings.mapZoomLevel ?? DEFAULT_OVERLAY_SETTINGS.mapZoomLevel,
              todos: cleanSettings.todos ?? DEFAULT_OVERLAY_SETTINGS.todos,
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
    if (!(key in SETTINGS_CONFIG) && key !== 'todos') { // todos is a valid key
      maliciousKeys.push(key);
    }
  }

  return maliciousKeys;
} 