import { type SunriseSunsetData } from '../api-utils';

/**
 * Creates a basic weather display when OpenWeatherMap fails
 */
export function createWeatherFallback(): { temp: number; desc: string } | null {
  return null;
}

/**
 * Creates a weather display with estimated temperature based on time of day
 */
export function createEstimatedWeatherFallback(timezone?: string): { temp: number; desc: string } | null {
  try {
    const now = new Date();
    let localTime: Date;

    if (timezone) {
      const timeStr = now.toLocaleString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours));
    } else {
      localTime = now;
    }

    const hour = localTime.getHours();

    let estimatedTemp: number;
    let description: string;

    if (hour >= 6 && hour < 12) {
      estimatedTemp = 20;
      description = 'estimated morning';
    } else if (hour >= 12 && hour < 18) {
      estimatedTemp = 25;
      description = 'estimated afternoon';
    } else if (hour >= 18 && hour < 22) {
      estimatedTemp = 20;
      description = 'estimated evening';
    } else {
      estimatedTemp = 15;
      description = 'estimated night';
    }

    return {
      temp: estimatedTemp,
      desc: description
    };
  } catch {
    return null;
  }
}

/**
 * Creates basic sunrise/sunset data when OpenWeatherMap fails
 */
export function createSunriseSunsetFallback(timezone?: string): SunriseSunsetData | null {
  try {
    const now = new Date();
    let localTime: Date;

    if (timezone) {
      const timeStr = now.toLocaleString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours, minutes] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours), parseInt(minutes));
    } else {
      localTime = now;
    }

    const sunrise = new Date(localTime);
    sunrise.setHours(6, 0, 0, 0);

    const sunset = new Date(localTime);
    sunset.setHours(18, 0, 0, 0);

    return {
      sunrise: sunrise.toISOString(),
      sunset: sunset.toISOString(),
      dayLength: '12:00:00'
    };
  } catch {
    return null;
  }
}

/**
 * Determines if it's night time using fallback logic
 */
export function isNightTimeFallback(timezone?: string): boolean {
  try {
    const now = new Date();
    let localTime: Date;

    if (timezone) {
      const timeStr = now.toLocaleString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hours, minutes] = timeStr.split(':');
      localTime = new Date();
      localTime.setHours(parseInt(hours), parseInt(minutes));
    } else {
      localTime = now;
    }

    const hour = localTime.getHours();
    return hour >= 19 || hour < 6;
  } catch {
    return false;
  }
}

/**
 * Checks if an API key is valid (basic format check)
 */
export function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.length < 10) return false;
  if (key.includes('your-') || key.includes('replace-')) return false;
  return true;
}
