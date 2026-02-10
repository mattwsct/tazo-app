// Settings validation utility to prevent malicious entries

import { OverlaySettings, SETTINGS_CONFIG, TodoItem } from '@/types/settings';
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

  // Validate showTodoList (it's in SETTINGS_CONFIG but handle explicitly for clarity)
  if (settings.showTodoList !== undefined) {
    if (typeof settings.showTodoList === 'boolean') {
      cleanSettings.showTodoList = settings.showTodoList;
    } else {
      console.warn('Invalid type for showTodoList: expected boolean');
      rejectedKeys.push('showTodoList');
    }
  }

  // Log any rejected keys (potential malicious entries)
  for (const key of Object.keys(settings)) {
    if (!(key in SETTINGS_CONFIG) && key !== 'todos' && key !== 'showTodoList') { // todos and showTodoList are handled separately
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

  for (const key of Object.keys(settingsObj)) {
    if (!(key in SETTINGS_CONFIG) && key !== 'todos' && key !== 'showTodoList') { // todos and showTodoList are valid keys
      maliciousKeys.push(key);
    }
  }

  return maliciousKeys;
} 