/**
 * Overlay-specific utility functions to reduce DRY violations
 */

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { LocationData } from '@/utils/location-utils';

/**
 * Merges settings with defaults, ensuring all fields are initialized
 * Used in multiple places: settings loading, SSE updates, polling
 */
/** Map legacy locationDisplay (neighbourhood) → city */
function migrateLocationDisplay(mode: string | undefined): OverlaySettings['locationDisplay'] {
  if (mode === 'neighbourhood') return 'city';
  if (mode === 'city' || mode === 'state' || mode === 'country' || mode === 'custom' || mode === 'hidden') return mode;
  return DEFAULT_OVERLAY_SETTINGS.locationDisplay;
}

/** Map legacy mapZoomLevel (neighbourhood/city/state/country) → match */
function migrateMapZoomLevel(level: string | undefined): OverlaySettings['mapZoomLevel'] {
  if (level === 'match' || level === 'ocean' || level === 'continental') return level;
  if (level === 'neighbourhood' || level === 'city' || level === 'state' || level === 'country') return 'match';
  return DEFAULT_OVERLAY_SETTINGS.mapZoomLevel;
}

export function mergeSettingsWithDefaults(settingsData: Partial<OverlaySettings>): OverlaySettings {
  const data = settingsData ?? {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- exclude legacy keys from spread
  const { leaderboardDisplay: _ld, broadenLocationWhenStale: _b, locationStaleMaxFallback: _m, showDistance: _sd, showDistanceMiles: _sdm, ...rest } = data as Record<string, unknown>;
  const legacy = data as { leaderboardDisplay?: string; showLeaderboard?: boolean };
  const showLeaderboard = data.showLeaderboard ?? (
    legacy.leaderboardDisplay === 'hidden' ? false :
    legacy.leaderboardDisplay !== undefined ? true :
    DEFAULT_OVERLAY_SETTINGS.showLeaderboard ?? true
  );
  return {
    ...DEFAULT_OVERLAY_SETTINGS,
    ...rest,
    locationDisplay: migrateLocationDisplay((rest as { locationDisplay?: string }).locationDisplay),
    mapZoomLevel: migrateMapZoomLevel((rest as { mapZoomLevel?: string }).mapZoomLevel),
    showLeaderboard,
    weatherConditionDisplay: settingsData.weatherConditionDisplay || DEFAULT_OVERLAY_SETTINGS.weatherConditionDisplay,
    altitudeDisplay: settingsData.altitudeDisplay || DEFAULT_OVERLAY_SETTINGS.altitudeDisplay,
    speedDisplay: settingsData.speedDisplay || DEFAULT_OVERLAY_SETTINGS.speedDisplay,
    showSteps: settingsData.showSteps ?? DEFAULT_OVERLAY_SETTINGS.showSteps,
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
