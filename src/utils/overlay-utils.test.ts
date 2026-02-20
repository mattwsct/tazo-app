import { describe, expect, it } from 'vitest';
import { mergeSettingsWithDefaults, getEffectiveDisplayModeForStaleGps } from '@/utils/overlay-utils';

describe('getEffectiveDisplayModeForStaleGps', () => {
  it('returns settings mode when GPS is fresh', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 60 * 1000)).toBe('neighbourhood');
    expect(getEffectiveDisplayModeForStaleGps('city', 60 * 1000)).toBe('city');
  });
  it('broadens neighbourhood to city after 5 min', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 6 * 60 * 1000)).toBe('city');
  });
  it('broadens to state after 10 min when neighbourhood or city', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 11 * 60 * 1000)).toBe('state');
    expect(getEffectiveDisplayModeForStaleGps('city', 11 * 60 * 1000)).toBe('state');
  });
  it('broadens to country after 15 min when maxFallback is country', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 16 * 60 * 1000, true, 'country')).toBe('country');
    expect(getEffectiveDisplayModeForStaleGps('city', 16 * 60 * 1000, true, 'country')).toBe('country');
    expect(getEffectiveDisplayModeForStaleGps('state', 16 * 60 * 1000, true, 'country')).toBe('country');
  });
  it('caps at state when maxFallback is state', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 16 * 60 * 1000, true, 'state')).toBe('state');
    expect(getEffectiveDisplayModeForStaleGps('city', 16 * 60 * 1000, true, 'state')).toBe('state');
  });
  it('caps at city when maxFallback is city', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 16 * 60 * 1000, true, 'city')).toBe('city');
  });
  it('returns hidden/custom as-is', () => {
    expect(getEffectiveDisplayModeForStaleGps('hidden', 20 * 60 * 1000)).toBe('hidden');
    expect(getEffectiveDisplayModeForStaleGps('custom', 20 * 60 * 1000)).toBe('custom');
  });
  it('returns settings when no GPS (age <= 0)', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 0)).toBe('neighbourhood');
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', -1)).toBe('neighbourhood');
  });
  it('does not broaden when broadenWhenStale is false', () => {
    expect(getEffectiveDisplayModeForStaleGps('neighbourhood', 25 * 60 * 1000, false)).toBe('neighbourhood');
    expect(getEffectiveDisplayModeForStaleGps('city', 25 * 60 * 1000, false)).toBe('city');
    expect(getEffectiveDisplayModeForStaleGps('state', 25 * 60 * 1000, false)).toBe('state');
  });
});

describe('mergeSettingsWithDefaults', () => {
  it('merges partial settings with defaults', () => {
    const result = mergeSettingsWithDefaults({ locationDisplay: 'country' });
    expect(result.locationDisplay).toBe('country');
    expect(result.showWeather).toBeDefined();
    expect(result.showMinimap).toBeDefined();
  });
  it('uses default when field not provided', () => {
    const result = mergeSettingsWithDefaults({});
    expect(result.locationDisplay).toBe('neighbourhood');
  });
  it('handles explicit empty optional fields', () => {
    const result = mergeSettingsWithDefaults({ weatherConditionDisplay: 'always' });
    expect(result.weatherConditionDisplay).toBe('always');
  });
});
