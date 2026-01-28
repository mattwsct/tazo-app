// === 🔄 UNIT CONVERSION UTILITIES ===

/**
 * Converts Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5) + 32);
}

/**
 * Converts km/h to mph
 */
export function kmhToMph(kmh: number): number {
  return Math.round(kmh * 0.621371);
}

/**
 * Converts meters to feet
 */
export function metersToFeet(meters: number): number {
  return Math.round(meters * 3.28084);
}
