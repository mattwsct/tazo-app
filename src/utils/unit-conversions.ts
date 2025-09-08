// === 🔄 UNIT CONVERSION UTILITIES ===

/**
 * Converts Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5) + 32);
}

/**
 * Converts kilometers per hour to miles per hour
 */
export function kmhToMph(kmh: number): number {
  return Math.round(kmh * 0.621371);
}

/**
 * Converts meters per second to kilometers per hour
 * RTIRL provides speed in meters per second (m/s)
 */
export function msToKmh(ms: number): number {
  return ms * 3.6;
}
