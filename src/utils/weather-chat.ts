// === 🌤️ WEATHER UTILITIES FOR CHAT COMMANDS ===

export interface WeatherEmojiMap {
  [key: string]: string;
}

/**
 * Gets weather emoji based on condition and time of day
 */
export function getWeatherEmoji(condition: string, isNight = false): string {
  const emojiMap: WeatherEmojiMap = {
    clear: isNight ? '🌙' : '☀️',
    clouds: '☁️',
    rain: '🌧️',
    drizzle: '🌦️',
    thunderstorm: '⛈️',
    snow: '❄️',
    mist: '🌫️',
    fog: '🌫️',
    haze: '🌫️',
  };
  return emojiMap[condition.toLowerCase()] || (isNight ? '🌙' : '🌤️');
}

/**
 * Checks if it's night time (8 PM to 6 AM)
 */
export function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}

/**
 * Formats temperature for chat (both °C and °F)
 */
export function formatTemperature(tempC: number): string {
  const tempF = Math.round(tempC * 9 / 5 + 32);
  return `${tempC}°C/${tempF}°F`;
}

/** UV index thresholds: 6+ high, 8+ very high, 11+ extreme */
export const UV_HIGH_THRESHOLD = 6;

/** AQI 4 = Poor, 5 = Very Poor — notable for IRL streaming */
export const AQI_POOR_THRESHOLD = 4;

export function isHighUV(uvIndex: number | null | undefined): boolean {
  return typeof uvIndex === 'number' && uvIndex >= UV_HIGH_THRESHOLD;
}

export function isPoorAirQuality(aqi: number | null | undefined): boolean {
  return typeof aqi === 'number' && aqi >= AQI_POOR_THRESHOLD;
}

const AQI_LABELS: Record<number, string> = {
  1: 'Good',
  2: 'Fair',
  3: 'Moderate',
  4: 'Poor',
  5: 'Very Poor',
};

export function formatUvResponse(uvIndex: number | null | undefined): string {
  if (typeof uvIndex !== 'number' || uvIndex < 0) return '☀️ UV data unavailable.';
  const level = uvIndex >= 11 ? 'Extreme' : uvIndex >= 8 ? 'Very high' : uvIndex >= 6 ? 'High' : uvIndex >= 3 ? 'Moderate' : 'Low';
  return `☀️ UV index ${uvIndex} (${level}).${uvIndex >= 6 ? ' Wear sunscreen!' : ''}`;
}

export function formatAqiResponse(aqi: number | null | undefined): string {
  if (typeof aqi !== 'number' || aqi < 1 || aqi > 5) return '💨 Air quality data unavailable.';
  const label = AQI_LABELS[aqi] || 'Unknown';
  return `💨 Air quality AQI ${aqi} (${label}).${aqi >= 4 ? ' Consider limiting outdoor exercise.' : ''}`;
}

/**
 * Checks if weather condition description is notable (affects IRL streaming).
 * Used for overlay auto-display and chat broadcast — we only broadcast on notable changes, not when clearing.
 */
export function isNotableWeatherCondition(desc: string): boolean {
  const d = desc.toLowerCase();
  return (
    d.includes('rain') ||
    d.includes('drizzle') ||
    d.includes('storm') ||
    d.includes('thunder') ||
    d.includes('snow') ||
    d.includes('sleet') ||
    d.includes('hail') ||
    d.includes('fog') ||
    d.includes('mist') ||
    d.includes('haze') ||
    d.includes('wind') ||
    d.includes('gale') ||
    d.includes('hurricane') ||
    d.includes('typhoon') ||
    d.includes('tornado') ||
    d.includes('blizzard') ||
    d.includes('freezing') ||
    d.includes('extreme')
  );
}

/**
 * Gets notable weather conditions for chat display
 */
export function getNotableConditions(data: {
  tempC: number;
  feelsLikeC: number;
  windKmh: number;
  humidity: number;
  visibility: number | null;
}): string[] {
  const conditions: string[] = [];
  const { tempC, windKmh, humidity, visibility } = data;

  if (windKmh > 30) conditions.push(`wind ${windKmh}km/h`);
  if (tempC > 35) {
    conditions.push(`very hot`);
  } else if (tempC < 0) {
    conditions.push(`very cold`);
  }
  if (humidity > 80) conditions.push(`high humidity (${humidity}%)`);
  else if (humidity < 30) conditions.push(`low humidity (${humidity}%)`);
  if (visibility !== null && visibility < 1) {
    conditions.push(`low visibility (${Math.round(visibility * 10) / 10}km)`);
  }
  return conditions;
}

/**
 * Gets precipitation type from condition
 */
export function getPrecipType(condition: string): string | null {
  const cond = condition.toLowerCase();
  if (cond === 'rain' || cond === 'drizzle') return 'rain';
  if (cond === 'snow') return 'snow';
  if (cond === 'thunderstorm') return 'storms';
  return 'precip';
}

/** OpenWeatherMap forecast API response shape */
interface OpenWeatherForecastResponse {
  list?: Array<{ dt?: number; pop?: number; weather?: Array<{ main?: string }> }>;
}

/**
 * Extracts precipitation forecast from forecast data
 */
export function extractPrecipitationForecast(fc: OpenWeatherForecastResponse | null | undefined): { chance: number; type: string } | null {
  if (!fc?.list || !Array.isArray(fc.list)) return null;

  const now = new Date();
  const currentTimestamp = now.getTime();
  let maxPop = 0;
  let precipType: string | null = null;
  
  for (const item of fc.list) {
    if (item.dt == null) continue;
    const forecastTime = new Date(item.dt * 1000);
    if (forecastTime.getTime() > currentTimestamp - 30 * 60 * 1000 &&
        forecastTime.getTime() <= currentTimestamp + 12 * 60 * 60 * 1000) {
      const pop = Math.round((item.pop || 0) * 100);
      if (pop > maxPop && pop >= 30) {
        maxPop = pop;
        const fcCondition = (item.weather?.[0]?.main || '').toLowerCase();
        precipType = getPrecipType(fcCondition) || (pop > 0 ? 'precip' : null);
      }
      if (forecastTime.getTime() > currentTimestamp + 12 * 60 * 60 * 1000) break;
    }
  }
  
  return maxPop > 0 && precipType ? { chance: maxPop, type: precipType } : null;
}

/**
 * Fetches current weather from OpenWeatherMap
 */
export async function fetchCurrentWeather(lat: number, lon: number, apiKey: string) {
  const response = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
  );
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Fetches forecast from OpenWeatherMap
 */
export async function fetchForecast(lat: number, lon: number, apiKey: string) {
  const response = await fetch(
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
  );
  if (!response.ok) return null;
  return await response.json();
}

/** Air Pollution API response shape */
interface AirPollutionResponse {
  list?: Array<{ main?: { aqi?: number } }>;
}

/**
 * Fetches current air pollution from OpenWeatherMap (same API key as weather)
 * AQI 1–5: Good, Fair, Moderate, Poor, Very Poor
 */
export async function fetchAirPollution(lat: number, lon: number, apiKey: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`
    );
    if (!response.ok) return null;
    const data: AirPollutionResponse = await response.json();
    const aqi = data.list?.[0]?.main?.aqi;
    return typeof aqi === 'number' && aqi >= 1 && aqi <= 5 ? aqi : null;
  } catch {
    return null;
  }
}

/**
 * Fetches UV index from OpenWeatherMap One Call API (requires One Call subscription for some keys).
 * Single API call only to stay within rate limits. Returns 0–11+; 6+ is high.
 */
export async function fetchUVIndex(lat: number, lon: number, apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const val = data?.current?.uvi;
    return typeof val === 'number' && val >= 0 ? Math.round(val * 10) / 10 : null;
  } catch {
    return null;
  }
}

/** OpenWeatherMap current weather API response shape */
interface OpenWeatherCurrentResponse {
  main?: { temp?: number; feels_like?: number; humidity?: number };
  weather?: Array<{ main?: string; description?: string }>;
  wind?: { speed?: number };
  visibility?: number;
}

/**
 * Parses weather data for chat display
 */
export function parseWeatherData(ow: OpenWeatherCurrentResponse | null | undefined) {
  if (!ow?.main?.temp) return null;

  const condition = (ow.weather?.[0]?.main || '').toLowerCase();
  const desc = (ow.weather?.[0]?.description || '').toLowerCase();
  const tempC = Math.round(ow.main.temp);
  const feelsLikeC = Math.round(ow.main.feels_like || tempC);
  const windKmh = Math.round((ow.wind?.speed || 0) * 3.6);
  const humidity = ow.main.humidity || 0;
  const visibility = ow.visibility ? (ow.visibility / 1000) : null;

  return {
    condition,
    desc,
    tempC,
    feelsLikeC,
    windKmh,
    humidity,
    visibility,
  };
}
