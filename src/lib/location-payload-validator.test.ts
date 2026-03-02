import { describe, expect, it } from 'vitest';
import { validateUpdateLocationPayload } from '@/lib/location-payload-validator';

describe('validateUpdateLocationPayload', () => {
  it('accepts valid payload with rtirl coords', () => {
    const body = {
      rtirl: { lat: 35.69, lon: 139.69, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    const result = validateUpdateLocationPayload(body);
    expect(result).not.toBeNull();
    expect(result!.rtirl.lat).toBe(35.69);
    expect(result!.rtirl.lon).toBe(139.69);
  });
  it('ignores and strips any location text fields (injection prevention)', () => {
    const body = {
      location: { city: 'HACKED', country: 'HACKED', countryCode: 'XX' },
      rtirl: { lat: 35.69, lon: 139.69, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    const result = validateUpdateLocationPayload(body);
    expect(result).not.toBeNull();
    // Result must not contain location text — only rtirl + updatedAt
    expect((result as Record<string, unknown>).location).toBeUndefined();
  });
  it('rejects payload without rtirl', () => {
    const body = { updatedAt: Date.now() };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
  it('rejects invalid lat/lon', () => {
    const body = {
      rtirl: { lat: 999, lon: 999, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    expect(validateUpdateLocationPayload(body)).toBeNull();
  });
  it('rejects non-object body', () => {
    expect(validateUpdateLocationPayload(null)).toBeNull();
    expect(validateUpdateLocationPayload('string')).toBeNull();
    expect(validateUpdateLocationPayload(42)).toBeNull();
  });
});
