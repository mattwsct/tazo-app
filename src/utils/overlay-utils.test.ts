import { describe, expect, it } from 'vitest';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';

describe('mergeSettingsWithDefaults', () => {
  it('merges partial settings with defaults', () => {
    const result = mergeSettingsWithDefaults({ locationDisplay: 'country' });
    expect(result.locationDisplay).toBe('country');
    expect(result.showWeather).toBeDefined();
    expect(result.showMinimap).toBeDefined();
  });
  it('uses default when field not provided', () => {
    const result = mergeSettingsWithDefaults({});
    expect(result.locationDisplay).toBe('city');
  });
  it('handles explicit empty optional fields', () => {
    const result = mergeSettingsWithDefaults({ weatherConditionDisplay: 'always' });
    expect(result.weatherConditionDisplay).toBe('always');
  });
});
