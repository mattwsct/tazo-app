import { describe, expect, it } from 'vitest';
import { validateUpdateLocationPayload } from '@/lib/location-payload-validator';

describe('validateUpdateLocationPayload', () => {
  it('accepts valid payload with location and rtirl', () => {
    const body = {
      location: { city: 'Tokyo', country: 'Japan', countryCode: 'jp' },
      rtirl: { lat: 35.69, lon: 139.69, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    const result = validateUpdateLocationPayload(body);
    expect(result).not.toBeNull();
    expect(result!.location.city).toBe('Tokyo');
    expect(result!.rtirl.lat).toBe(35.69);
  });
  it('rejects payload without location', () => {
    const body = { rtirl: { lat: 0, lon: 0, updatedAt: Date.now() }, updatedAt: Date.now() };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
  it('rejects payload without rtirl', () => {
    const body = { location: { country: 'Japan' }, updatedAt: Date.now() };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
  it('rejects location without any useful fields', () => {
    const body = {
      location: {},
      rtirl: { lat: 0, lon: 0, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
  it('sanitizes invalid lat/lon', () => {
    const body = {
      location: { country: 'Japan', countryCode: 'jp' },
      rtirl: { lat: 999, lon: 999, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
});
