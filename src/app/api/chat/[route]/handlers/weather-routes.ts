import { NextResponse } from 'next/server';
import {
  getWeatherEmoji,
  isNightTime,
  formatTemperature,
  getNotableConditions,
  fetchForecast,
  formatUvResponse,
  formatAqiResponse,
} from '@/utils/weather-chat';
import { getLocationData } from '@/utils/location-cache';
import { requireApiKey, txtResponse, ChatContext } from './shared';

export async function handleWeatherRoutes(route: string, q: string, ctx: ChatContext): Promise<NextResponse | null> {
  const { persistentLocation, lat, lon, locationData } = ctx;

  if (route === 'weather') {
    const freshData = locationData || await getLocationData();
    if (!freshData || !freshData.weather) {
      return txtResponse('Weather data unavailable');
    }

    const { condition, desc, tempC, feelsLikeC, windKmh, humidity, visibility } = freshData.weather;
    const emoji = getWeatherEmoji(condition, isNightTime());
    const notableConditions = getNotableConditions({
      tempC,
      feelsLikeC,
      windKmh,
      humidity,
      visibility,
    });

    const parts: string[] = [];
    parts.push(`${emoji} ${formatTemperature(tempC)} ${desc}`);

    if (Math.abs(feelsLikeC - tempC) > 1) {
      parts.push(`feels like ${formatTemperature(feelsLikeC)}`);
    }

    const alerts: string[] = [];
    if (condition === 'thunderstorm') {
      alerts.push('⚠️ Thunderstorm warning');
    }
    if (windKmh > 60) {
      alerts.push('⚠️ High wind warning');
    } else if (windKmh > 40) {
      alerts.push('⚠️ Strong winds');
    }
    if (tempC > 40) {
      alerts.push('⚠️ Extreme heat warning');
    } else if (tempC < -15) {
      alerts.push('⚠️ Extreme cold warning');
    }
    if (humidity > 90 && tempC > 30) {
      alerts.push('⚠️ Heat advisory');
    }
    if (visibility !== null && visibility < 0.5) {
      alerts.push('⚠️ Low visibility warning');
    }

    if (alerts.length > 0) {
      parts.push(alerts.join(', '));
    }

    if (notableConditions.length > 0) {
      parts.push(notableConditions.join(', '));
    }

    return txtResponse(parts.join(' · '));
  }

  if (route === 'uv') {
    const freshData = locationData || await getLocationData();
    if (!freshData?.weather) return txtResponse(formatUvResponse(null));
    return txtResponse(formatUvResponse(freshData.weather.uvIndex));
  }

  if (route === 'aqi') {
    const freshData = locationData || await getLocationData();
    if (!freshData?.weather) return txtResponse(formatAqiResponse(null));
    return txtResponse(formatAqiResponse(freshData.weather.aqi));
  }

  if (route === 'forecast') {
    const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
    const keyError = requireApiKey(openweatherKey, 'Forecast');
    if (keyError) return txtResponse(keyError.error);

    const freshData = locationData || await getLocationData();
    const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
    if (!timezone) {
      return txtResponse('Timezone unavailable for forecast');
    }

    const forecastLat = lat !== null ? lat : (persistentLocation?.rtirl.lat || null);
    const forecastLon = lon !== null ? lon : (persistentLocation?.rtirl.lon || null);

    if (forecastLat === null || forecastLon === null) {
      return txtResponse('No location available for forecast');
    }

    const fc = await fetchForecast(forecastLat, forecastLon, openweatherKey!);
    if (!fc?.list || !Array.isArray(fc.list) || fc.list.length === 0) {
      return txtResponse('No forecast data available');
    }

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });

    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: timezone });

    const dailyForecasts = new Map<string, typeof fc.list>();
    for (const item of fc.list) {
      if (!item?.dt || !item?.main?.temp) continue;
      const forecastTime = new Date(item.dt * 1000);
      const dateStr = forecastTime.toLocaleDateString('en-CA', { timeZone: timezone });

      if (!dailyForecasts.has(dateStr)) {
        dailyForecasts.set(dateStr, []);
      }
      dailyForecasts.get(dateStr)!.push(item);
    }

    const sortedDates = Array.from(dailyForecasts.keys()).sort();

    let todayIndex = sortedDates.findIndex(date => date === todayStr);

    if (todayIndex === -1) {
      if (sortedDates.length > 0) {
        todayIndex = 0;
      } else {
        return txtResponse('No forecast data available');
      }
    }

    const out: string[] = [];
    let count = 0;

    for (let i = todayIndex; i < sortedDates.length && count < 5; i++) {
      const dateStr = sortedDates[i];
      const items = dailyForecasts.get(dateStr)!;

      let dateLabel: string;
      if (dateStr === todayStr) {
        dateLabel = 'Today';
      } else if (dateStr === tomorrowStr) {
        dateLabel = 'Tomorrow';
      } else {
        const firstItem = items[0];
        if (firstItem?.dt) {
          const date = new Date(firstItem.dt * 1000);
          dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
        } else {
          const [year, month, day] = dateStr.split('-').map(Number);
          const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
          dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
        }
      }

      let minTempC = Infinity;
      let maxTempC = -Infinity;
      const conditions: string[] = [];
      let windSpeed = 0;
      let humidity = 0;

      for (const item of items) {
        if (item?.main?.temp != null) {
          const temp = Math.round(item.main.temp);
          if (temp < minTempC) minTempC = temp;
          if (temp > maxTempC) maxTempC = temp;
        }
        if (item?.weather?.[0]?.main) {
          const cond = item.weather[0].main.toLowerCase();
          if (!conditions.includes(cond)) conditions.push(cond);
        }
        if (item?.wind?.speed) {
          windSpeed = Math.max(windSpeed, item.wind.speed * 3.6);
        }
        if (item?.main?.humidity) {
          humidity = Math.max(humidity, item.main.humidity);
        }
      }

      if (minTempC === Infinity || maxTempC === -Infinity) continue;

      const condition = conditions[0] || items[0]?.weather?.[0]?.main?.toLowerCase() || '';
      const emoji = getWeatherEmoji(condition);
      const minTempF = Math.round(minTempC * 9 / 5 + 32);
      const maxTempF = Math.round(maxTempC * 9 / 5 + 32);

      const tempRange = minTempC === maxTempC
        ? `${minTempC}°C/${minTempF}°F`
        : `${minTempC}-${maxTempC}°C/${minTempF}-${maxTempF}°F`;

      const forecastParts = [`${emoji} ${dateLabel} ${tempRange}`];
      if (windSpeed > 20) {
        forecastParts.push(`${Math.round(windSpeed)}km/h wind`);
      }
      if (humidity > 80) {
        forecastParts.push(`${humidity}% humidity`);
      }

      out.push(forecastParts.join(' · '));
      count++;
    }

    return txtResponse(out.length > 0 ? out.join(' | ') : 'No forecast data available');
  }

  if (route === 'sun') {
    const freshData = locationData || await getLocationData();
    if (!freshData || !freshData.timezone || !freshData.sunriseSunset) {
      return txtResponse('Sunrise/sunset data unavailable');
    }

    const now = new Date();
    const sunriseUtc = new Date(freshData.sunriseSunset.sunrise * 1000);
    const sunsetUtc = new Date(freshData.sunriseSunset.sunset * 1000);
    const timeOptions = {
      hour: 'numeric' as const,
      minute: '2-digit' as const,
      hour12: true,
      timeZone: freshData.timezone,
    };
    const sunriseStr = sunriseUtc.toLocaleTimeString('en-US', timeOptions);
    const sunsetStr = sunsetUtc.toLocaleTimeString('en-US', timeOptions);

    const DAY_MS = 24 * 60 * 60 * 1000;
    const timeUntilSunrise = sunriseUtc.getTime() - now.getTime();
    const timeUntilSunset = sunsetUtc.getTime() - now.getTime();
    const msUntilNextSunrise = timeUntilSunrise >= 0 ? timeUntilSunrise : timeUntilSunrise + DAY_MS;
    const msUntilNextSunset = timeUntilSunset >= 0 ? timeUntilSunset : timeUntilSunset + DAY_MS;

    const formatTimeUntil = (ms: number, isTomorrow: boolean): string => {
      const hours = Math.floor(ms / (60 * 60 * 1000));
      const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
      const m = minutes.toString().padStart(2, '0');
      return isTomorrow ? `in ${hours}h ${m}m tomorrow` : `in ${hours}h ${m}m`;
    };

    const sunriseUntil = formatTimeUntil(msUntilNextSunrise, timeUntilSunrise < 0);
    const sunsetUntil = formatTimeUntil(msUntilNextSunset, timeUntilSunset < 0);

    const sunriseFirst = msUntilNextSunrise <= msUntilNextSunset;
    const parts = sunriseFirst
      ? [`🌅 Sunrise ${sunriseStr} (${sunriseUntil})`, `🌇 Sunset ${sunsetStr} (${sunsetUntil})`]
      : [`🌇 Sunset ${sunsetStr} (${sunsetUntil})`, `🌅 Sunrise ${sunriseStr} (${sunriseUntil})`];

    return txtResponse(parts.join(' · '));
  }

  return null;
}
