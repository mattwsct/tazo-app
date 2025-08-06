import { WMO_TO_OPENWEATHER, WEATHER_FALLBACK_MAP } from './overlay-constants';

// Weather icon mapping
export function getWeatherIcon(
  wmoCode: string, 
  timezone: string | null, 
  sunrise: string | null, 
  sunset: string | null
): string {
  const baseIcon = WMO_TO_OPENWEATHER[wmoCode] || '01';
  
  // Determine if it's day or night
  if (!timezone) return baseIcon + 'd';

  try {
    const now = new Date();
    const currentLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    let isDay = true;

    if (sunrise && sunset) {
      const sunriseTime = new Date(sunrise);
      const sunsetTime = new Date(sunset);
      isDay = currentLocal >= sunriseTime && currentLocal < sunsetTime;
    } else {
      const hour = currentLocal.getHours();
      isDay = hour >= 6 && hour < 18; // Simple day/night detection
    }

    return baseIcon + (isDay ? 'd' : 'n');
  } catch {
    return baseIcon + 'd'; // Fallback to day icon
  }
}

// Weather fallback emoji
export function getWeatherFallback(wmoCode: string): string {
  return WEATHER_FALLBACK_MAP[wmoCode] || '🌤️';
}

// Temperature conversion
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5) + 32);
} 