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
 * Condenses OpenWeatherMap descriptions for chat (e.g. "moderate rain" → "rain", "broken clouds" → "clouds")
 */
export function condenseWeatherDescription(desc: string): string {
  if (!desc || !desc.trim()) return desc;
  const d = desc.toLowerCase().trim();
  // Strip intensity/cloud-cover modifiers
  let core = d
    .replace(/^(very heavy|heavy intensity|heavy|moderate|light intensity|light|extreme)\s+/i, '')
    .replace(/^(few|broken|overcast|scattered)\s+/i, '')
    .replace(/\s+with\s+(light\s+)?(heavy\s+)?rain$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (core === 'clear sky') return 'clear';
  if (core === 'cloud' || core === 'clouds') return 'clouds';
  return core || d;
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
  if (typeof uvIndex !== 'number' || uvIndex < 0) {
    return isNightTime()
      ? '☀️ UV is negligible at night (sun is down).'
      : '☀️ UV data unavailable.';
  }
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

/** Minutely precipitation forecast from One Call 3.0 */
export interface MinutelyPrecipForecast {
  event: 'starting' | 'stopping';
  targetTime: number;
  precipType: string;
  fetchedAt: number;
}

/**
 * Fetches minutely precipitation data from One Call 3.0.
 * Returns a forecast of when precipitation starts or stops within the next 60 minutes.
 */
export async function fetchMinutelyForecast(
  lat: number, lon: number, apiKey: string, currentTempC?: number
): Promise<MinutelyPrecipForecast | null> {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,hourly,daily,alerts&appid=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseMinutelyData(data?.minutely, currentTempC);
  } catch {
    return null;
  }
}

const PRECIP_THRESHOLD = 0.1; // mm/h — ignore trace moisture

/**
 * Parses One Call 3.0 minutely array into an actionable forecast.
 * Detects the next transition: dry→wet (starting) or wet→dry (stopping).
 */
export function parseMinutelyData(
  minutely: Array<{ dt: number; precipitation: number }> | undefined,
  currentTempC?: number,
): MinutelyPrecipForecast | null {
  if (!minutely || minutely.length < 5) return null;

  const now = Date.now();
  const precipType = (currentTempC != null && currentTempC <= 2) ? 'SNOW' : 'RAIN';

  const isWet = (entry: { precipitation: number }) => entry.precipitation >= PRECIP_THRESHOLD;
  const currentlyWet = isWet(minutely[0]);

  // Require at least 3 consecutive minutes in the new state to avoid flicker
  const MIN_CONSECUTIVE = 3;

  for (let i = 1; i <= minutely.length - MIN_CONSECUTIVE; i++) {
    const transitioned = currentlyWet ? !isWet(minutely[i]) : isWet(minutely[i]);
    if (!transitioned) continue;

    let sustained = true;
    for (let j = 1; j < MIN_CONSECUTIVE; j++) {
      if (i + j >= minutely.length) { sustained = false; break; }
      const check = currentlyWet ? !isWet(minutely[i + j]) : isWet(minutely[i + j]);
      if (!check) { sustained = false; break; }
    }
    if (!sustained) continue;

    const targetTime = minutely[i].dt * 1000;
    if (targetTime <= now) continue;

    return {
      event: currentlyWet ? 'stopping' : 'starting',
      targetTime,
      precipType,
      fetchedAt: now,
    };
  }

  return null;
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
  const rawDesc = (ow.weather?.[0]?.description || '').toLowerCase();
  const desc = condenseWeatherDescription(rawDesc);
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
