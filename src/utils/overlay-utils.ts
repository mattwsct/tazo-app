/**
 * Overlay-specific utility functions to reduce DRY violations
 */

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { LocationData } from '@/utils/location-utils';
import { TIMERS } from '@/utils/overlay-constants';

/**
 * Merges settings with defaults, ensuring all fields are initialized
 * Used in multiple places: settings loading, SSE updates, polling
 */
export function mergeSettingsWithDefaults(settingsData: Partial<OverlaySettings>): OverlaySettings {
  return {
    ...DEFAULT_OVERLAY_SETTINGS,
    ...settingsData,
    weatherConditionDisplay: settingsData.weatherConditionDisplay || DEFAULT_OVERLAY_SETTINGS.weatherConditionDisplay,
    altitudeDisplay: settingsData.altitudeDisplay || DEFAULT_OVERLAY_SETTINGS.altitudeDisplay,
    speedDisplay: settingsData.speedDisplay || DEFAULT_OVERLAY_SETTINGS.speedDisplay,
    minimapTheme: settingsData.minimapTheme || DEFAULT_OVERLAY_SETTINGS.minimapTheme,
  };
}

/**
 * Checks if location data has complete information (more than just country)
 * Used in multiple places: location formatting, settings change detection
 * Includes state/province so state-only mode works (e.g. rural areas)
 */
export function hasCompleteLocationData(location: LocationData | null): boolean {
  if (!location) return false;
  
  return !!(
    location.city || 
    location.town || 
    location.village || 
    location.municipality ||
    location.neighbourhood || 
    location.suburb || 
    location.district ||
    location.state ||
    location.province ||
    location.region
  );
}

/**
 * Formats country code consistently (uppercase)
 * Used in multiple places: location display, flag rendering
 */
export function formatCountryCode(countryCode?: string): string {
  return countryCode?.toUpperCase() || '';
}

/** Location display mode (same as settings, excluding custom/hidden) */
type LocationPrecisionMode = 'neighbourhood' | 'city' | 'state' | 'country';

/**
 * Returns effective display mode when GPS data is stale.
 * Broader modes are more accurate when travelling without fresh fixes (e.g. underground).
 * Only applies to neighbourhood/city/state - country is already maximally broad.
 */
export function getEffectiveDisplayModeForStaleGps(
  displayMode: LocationPrecisionMode | 'custom' | 'hidden',
  gpsAgeMs: number
): LocationPrecisionMode | 'custom' | 'hidden' {
  if (displayMode === 'hidden' || displayMode === 'custom') return displayMode;
  if (gpsAgeMs <= 0) return displayMode; // No GPS yet, use settings

  const { STALE_NEIGHBOURHOOD_MS, STALE_CITY_MS } = TIMERS;
  if (gpsAgeMs >= STALE_CITY_MS && (displayMode === 'neighbourhood' || displayMode === 'city')) return 'state';
  if (gpsAgeMs >= STALE_NEIGHBOURHOOD_MS && displayMode === 'neighbourhood') return 'city';
  return displayMode;
}

/**
 * Checks if display mode should show data based on auto/always/hidden settings
 */
export function shouldShowDisplayMode(
  displayMode: 'auto' | 'always' | 'hidden',
  isStale: boolean,
  meetsCondition: boolean
): boolean {
  if (displayMode === 'hidden') return false;
  if (displayMode === 'always') return true;
  // Auto mode: show only if not stale and meets condition
  return !isStale && meetsCondition;
}
