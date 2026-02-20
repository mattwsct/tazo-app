/**
 * Overlay-specific utility functions to reduce DRY violations
 */

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, type LocationStaleMaxFallback } from '@/types/settings';
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
    broadenLocationWhenStale: settingsData.broadenLocationWhenStale ?? DEFAULT_OVERLAY_SETTINGS.broadenLocationWhenStale ?? true,
    locationStaleMaxFallback: settingsData.locationStaleMaxFallback ?? DEFAULT_OVERLAY_SETTINGS.locationStaleMaxFallback ?? 'country',
    weatherConditionDisplay: settingsData.weatherConditionDisplay || DEFAULT_OVERLAY_SETTINGS.weatherConditionDisplay,
    altitudeDisplay: settingsData.altitudeDisplay || DEFAULT_OVERLAY_SETTINGS.altitudeDisplay,
    speedDisplay: settingsData.speedDisplay || DEFAULT_OVERLAY_SETTINGS.speedDisplay,
    showSteps: settingsData.showSteps ?? DEFAULT_OVERLAY_SETTINGS.showSteps,
    showDistance: settingsData.showDistance ?? DEFAULT_OVERLAY_SETTINGS.showDistance,
    showDistanceMiles: settingsData.showDistanceMiles ?? DEFAULT_OVERLAY_SETTINGS.showDistanceMiles,
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

const PRECISION_ORDER: LocationPrecisionMode[] = ['neighbourhood', 'city', 'state', 'country'];

function capAtMaxFallback(mode: LocationPrecisionMode, max: LocationStaleMaxFallback): LocationPrecisionMode {
  const maxIdx = PRECISION_ORDER.indexOf(max);
  const modeIdx = PRECISION_ORDER.indexOf(mode);
  return PRECISION_ORDER[Math.min(modeIdx, maxIdx)];
}

/**
 * Returns effective display mode when GPS data is stale.
 * When broadenWhenStale is true: broader modes are more accurate when travelling without fresh fixes (e.g. underground).
 * When false: always use the selected display mode regardless of GPS age.
 * Progression: neighbourhood → city (5 min) → state (10 min) → country (15 min). Max fallback caps how far we go.
 */
export function getEffectiveDisplayModeForStaleGps(
  displayMode: LocationPrecisionMode | 'custom' | 'hidden',
  gpsAgeMs: number,
  broadenWhenStale: boolean = true,
  maxFallback: LocationStaleMaxFallback = 'country'
): LocationPrecisionMode | 'custom' | 'hidden' {
  if (displayMode === 'hidden' || displayMode === 'custom') return displayMode;
  if (!broadenWhenStale || gpsAgeMs <= 0) return displayMode; // No broadening, or no GPS yet, use settings

  const { STALE_NEIGHBOURHOOD_MS, STALE_CITY_MS, STALE_STATE_MS } = TIMERS;
  let effective: LocationPrecisionMode = displayMode;
  if (gpsAgeMs >= STALE_STATE_MS) effective = 'country';
  else if (gpsAgeMs >= STALE_CITY_MS && (displayMode === 'neighbourhood' || displayMode === 'city')) effective = 'state';
  else if (gpsAgeMs >= STALE_NEIGHBOURHOOD_MS && displayMode === 'neighbourhood') effective = 'city';
  return capAtMaxFallback(effective, maxFallback);
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
