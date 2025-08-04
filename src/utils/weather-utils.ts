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

// Temperature zones and color mapping - High contrast for dark overlays
const TEMPERATURE_ZONES = {
  VERY_COLD: { min: -50, max: 9, color: '#87CEEB', name: 'Very Cold' },      // Light cyan
  COLD: { min: 10, max: 17, color: '#ADD8E6', name: 'Cold' },                // Light blue
  COMFORTABLE: { min: 18, max: 23, color: '#FFFFFF', name: 'Comfortable' },  // White
  WARM: { min: 24, max: 27, color: '#FFB347', name: 'Warm' },                // Light orange
  HOT: { min: 28, max: 34, color: '#FF8C00', name: 'Hot' },                  // Orange
  VERY_HOT: { min: 35, max: 50, color: '#FF4444', name: 'Very Hot' },        // Bright red
} as const;

// Temperature zone detection
export function getTemperatureZone(temp: number) {
  return Object.values(TEMPERATURE_ZONES).find(zone => temp >= zone.min && temp <= zone.max) || TEMPERATURE_ZONES.VERY_HOT;
}

// Weather fallback emoji
export function getWeatherFallback(wmoCode: string): string {
  return WEATHER_FALLBACK_MAP[wmoCode] || '🌤️';
}

// Temperature conversion
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9/5) + 32;
} 