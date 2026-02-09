import { NextRequest, NextResponse } from 'next/server';
import { cleanQuery, roundCoordinate } from '@/utils/chat-utils';
import { fetchLocationFromLocationIQ, fetchWeatherAndTimezoneFromOpenWeatherMap } from '@/utils/api-utils';
import { getCityLocationForChat, pickN } from '@/utils/chat-utils';
import { getTravelData } from '@/utils/travel-data';
import { handleSizeRanking, getSizeRouteConfig, isSizeRoute } from '@/utils/size-ranking';
import { fetchRTIRLData } from '@/utils/rtirl-utils';
import {
  getWeatherEmoji,
  isNightTime,
  formatTemperature,
  getNotableConditions,
  fetchCurrentWeather,
  fetchForecast,
  parseWeatherData,
  extractPrecipitationForecast,
} from '@/utils/weather-chat';
import { getLocationData } from '@/utils/location-cache';
import { getHeartrateStats, getSpeedStats, getAltitudeStats, getDistanceTraveled, getCountriesVisited, getCitiesVisited } from '@/utils/stats-storage';

export const dynamic = 'force-dynamic';

// CORS headers for chat commands
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

// Social media route mapping
const SOCIAL_ROUTES: Record<string, { name: string; url: (u: string) => string; fallback: string }> = {
  instagram: { name: 'Instagram', url: (u) => `https://instagram.com/${u}`, fallback: 'https://tazo.wtf/instagram' },
  tiktok: { name: 'TikTok', url: (u) => `https://tiktok.com/@${u}`, fallback: 'https://tazo.wtf/tiktok' },
  youtube: { name: 'YouTube', url: (u) => `https://youtube.com/@${u}`, fallback: 'https://tazo.wtf/youtube' },
  twitter: { name: 'Twitter', url: (u) => `https://x.com/${u}`, fallback: 'https://tazo.wtf/twitter' },
  kick: { name: 'Kick', url: (u) => `https://kick.com/${u}`, fallback: 'https://tazo.wtf/kick' },
  rumble: { name: 'Rumble', url: (u) => `https://rumble.com/user/${u}`, fallback: 'https://tazo.wtf/rumble' },
  twitch: { name: 'Twitch', url: (u) => `https://twitch.tv/${u}`, fallback: 'https://tazo.wtf/twitch' },
  parti: { name: 'Parti', url: (u) => `https://parti.live/${u}`, fallback: 'https://tazo.wtf/parti' },
  dlive: { name: 'DLive', url: (u) => `https://dlive.tv/${u}`, fallback: 'https://tazo.wtf/dlive' },
};

function txtResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}

function jsonResponse(obj: unknown, status = 200) {
  return NextResponse.json(obj, {
    status,
    headers: {
      'cache-control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}

// Helper to get API key or return error response
function requireApiKey(key: string | undefined, name: string) {
  if (!key) {
    return { error: `${name} API not configured` };
  }
  return null;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'access-control-max-age': '86400',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ route: string }> }
): Promise<NextResponse> {
  const { route } = await params;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  // Social media routes (no RTIRL required)
  if (route in SOCIAL_ROUTES) {
    const config = SOCIAL_ROUTES[route];
    const socialUser = cleanQuery(q);
    return txtResponse(
      socialUser
        ? `${config.name} → ${config.url(socialUser)}`
        : `${config.name} → ${config.fallback}`
    );
  }

  // Shoutout route (no RTIRL required)
  if (route === 'shoutout' || route === 'so') {
    const socialUser = cleanQuery(q);
    if (!socialUser) return txtResponse('Usage: !so <username>');

    const provider = (url.searchParams.get('p') || '').toLowerCase();
    const providers: Record<string, (u: string) => string> = {
      twitch: (u) => `https://twitch.tv/${u}`,
      youtube: (u) => `https://youtube.com/@${u}`,
    };

    const link = providers[provider]?.(socialUser) || `https://kick.com/${socialUser}`;
    return txtResponse(`Check out ${socialUser} → ${link}`);
  }

  // Size ranking routes (no RTIRL required)
  if (isSizeRoute(route)) {
    let length: number, girth: number | null = null, unit: 'inch' | 'cm', type: 'erect' | 'flaccid';
    
    const queryStr = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('querystring') || '';
    
    if (queryStr) {
      const parts = queryStr.trim().split(/\s+/).filter(p => p);
      length = parseFloat(parts[0] || '');
      girth = parts[1] ? parseFloat(parts[1]) : null;
    } else {
      length = parseFloat(url.searchParams.get('l') || url.searchParams.get('length') || '');
      const girthParam = url.searchParams.get('g') || url.searchParams.get('girth');
      girth = girthParam ? parseFloat(girthParam) : null;
    }

    const routeConfig = getSizeRouteConfig(route);
    if (routeConfig) {
      ({ unit, type } = routeConfig);
    } else {
      unit = (url.searchParams.get('unit') || 'inch').toLowerCase() as 'inch' | 'cm';
      type = (url.searchParams.get('type') || 'erect').toLowerCase() as 'erect' | 'flaccid';
    }

    if (isNaN(length) || length <= 0) {
      const routeName = routeConfig ? route : 'size';
      return txtResponse(`Usage: ${routeName} 7 (length) 5.5 (girth)`, 200);
    }

    const result = handleSizeRanking(length, girth, unit, type);
    if (!result) {
      return txtResponse(`Invalid input. Usage: ${route} 7 (length) 5.5 (girth)`, 200);
    }

    return txtResponse(result, 200);
  }

  // Routes that require RTIRL
  try {
    // Use cached location data if available (5min TTL), otherwise fetch fresh
    const locationData = await getLocationData();
    
    if (!locationData || !locationData.rtirl.lat || !locationData.rtirl.lon) {
      return txtResponse('No RTIRL location available', 200);
    }

    const { lat, lon } = locationData.rtirl;

    // Location route - uses cached data
    if (route === 'location') {
      if (locationData.location?.name) {
        return txtResponse(locationData.location.name);
      }
      return txtResponse('Location unavailable');
    }

    // Weather route - uses cached data
    if (route === 'weather') {
      if (!locationData.weather) {
        return txtResponse('Weather data unavailable');
      }

      const { condition, desc, tempC, feelsLikeC, windKmh, humidity, visibility } = locationData.weather;
      const emoji = getWeatherEmoji(condition, isNightTime());
      const notableConditions = getNotableConditions({
        tempC,
        feelsLikeC,
        windKmh,
        humidity,
        visibility,
      });

      let response = `${emoji} ${formatTemperature(tempC)} ${desc}`;
      if (notableConditions.length > 0) {
        response += `, ${notableConditions.join(', ')}`;
      }

      return txtResponse(response);
    }

    // Forecast route - fetch fresh (not cached, needs full forecast data)
    if (route === 'forecast') {
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
      const keyError = requireApiKey(openweatherKey, 'Forecast');
      if (keyError) return txtResponse(keyError.error);

      // Get timezone from cached location data
      const timezone = locationData.timezone;
      if (!timezone) {
        return txtResponse('Timezone unavailable for forecast');
      }

      // Forecast needs full data, fetch fresh
      const fc = await fetchForecast(lat, lon, openweatherKey!);
      if (!fc?.list || !Array.isArray(fc.list) || fc.list.length === 0) {
        return txtResponse('No forecast data available');
      }

      // Get current date in location's timezone (YYYY-MM-DD format)
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
      
      // Group forecasts by date in location's timezone
      const dailyForecasts = new Map<string, typeof fc.list>();
      for (const item of fc.list) {
        if (!item?.dt || !item?.main?.temp) continue;
        const forecastTime = new Date(item.dt * 1000);
        // Convert to location's timezone and get date string (YYYY-MM-DD)
        const dateStr = forecastTime.toLocaleDateString('en-CA', { timeZone: timezone });
        
        if (!dailyForecasts.has(dateStr)) {
          dailyForecasts.set(dateStr, []);
        }
        dailyForecasts.get(dateStr)!.push(item);
      }

      // Sort dates to ensure correct order (YYYY-MM-DD format sorts correctly)
      const sortedDates = Array.from(dailyForecasts.keys()).sort();
      
      // Find today's date in the forecast
      let todayIndex = sortedDates.findIndex(date => date === todayStr);
      if (todayIndex === -1) {
        // Today not in forecast (might be late at night and forecast starts tomorrow)
        // Check if first date is tomorrow
        if (sortedDates.length > 0) {
          const firstDate = sortedDates[0];
          // If first date is after today, we'll treat it as "today" (next available day)
          todayIndex = 0;
        } else {
          return txtResponse('No forecast data available');
        }
      }

      const out: string[] = [];
      let count = 0;
      
      // Process today and tomorrow
      for (let i = todayIndex; i < sortedDates.length && count < 2; i++) {
        const dateStr = sortedDates[i];
        const items = dailyForecasts.get(dateStr)!;
        
        const dateLabel = count === 0 ? 'Today' : 'Tomorrow';

        let minTempC = Infinity;
        let maxTempC = -Infinity;
        for (const item of items) {
          if (item?.main?.temp != null) {
            const temp = Math.round(item.main.temp);
            if (temp < minTempC) minTempC = temp;
            if (temp > maxTempC) maxTempC = temp;
          }
        }

        if (minTempC === Infinity || maxTempC === -Infinity) continue;

        // Use most common condition or first item's condition
        const condition = items[0]?.weather?.[0]?.main?.toLowerCase() || '';
        const emoji = getWeatherEmoji(condition);
        const minTempF = Math.round(minTempC * 9 / 5 + 32);
        const maxTempF = Math.round(maxTempC * 9 / 5 + 32);

        // Format: show single temp if min === max, otherwise range
        const tempRange = minTempC === maxTempC 
          ? `${minTempC}°C/${minTempF}°F`
          : `${minTempC}-${maxTempC}°C/${minTempF}-${maxTempF}°F`;

        out.push(`${emoji} ${dateLabel} ${tempRange}`);
        count++;
      }

      return txtResponse(out.length > 0 ? out.join(' | ') : 'No forecast data available');
    }

    // Sun route (sunrise/sunset) - uses cached data
    if (route === 'sun') {
      if (!locationData.timezone || !locationData.sunriseSunset) {
        return txtResponse('Sunrise/sunset data unavailable');
      }

      const sunriseUtc = new Date(locationData.sunriseSunset.sunrise * 1000);
      const sunsetUtc = new Date(locationData.sunriseSunset.sunset * 1000);
      const timeOptions = {
        hour: 'numeric' as const,
        minute: '2-digit' as const,
        hour12: true,
        timeZone: locationData.timezone,
      };
      const sunriseStr = sunriseUtc.toLocaleTimeString('en-US', timeOptions);
      const sunsetStr = sunsetUtc.toLocaleTimeString('en-US', timeOptions);

      const sunriseIsTomorrow = sunriseUtc.getTime() > sunsetUtc.getTime();
      return txtResponse(
        sunriseIsTomorrow
          ? `🌇 Sunset ${sunsetStr}, 🌅 Sunrise ${sunriseStr}`
          : `🌅 Sunrise ${sunriseStr}, 🌇 Sunset ${sunsetStr}`
      );
    }

    // Time route - uses cached timezone
    if (route === 'time') {
      if (!locationData.timezone) {
        return txtResponse('Time unavailable');
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: locationData.timezone,
      });
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: locationData.timezone,
      });
      return txtResponse(`${timeStr} on ${dateStr} (${locationData.timezone})`);
    }

    // Map route - uses cached coordinates
    if (route === 'map') {
      const roundedLat = roundCoordinate(lat);
      const roundedLon = roundCoordinate(lon);
      const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundedLat},${roundedLon}`)}`;
      return txtResponse(mapUrl);
    }

    // Travel routes (food, phrase, sidequest) - uses cached country code
    if (route === 'food' || route === 'phrase' || route === 'sidequest') {
      const countryCode = locationData.location?.countryCode || null;
      const travelData = getTravelData(countryCode);
      const noDataMsg = 'No local data for this country yet';

      if (route === 'food') {
        const foods = pickN(travelData.foods, 3);
        return txtResponse(foods.length > 0 ? foods.join(' · ') : noDataMsg);
      }

      if (route === 'phrase') {
        const phrases = pickN(travelData.phrases, 3);
        if (phrases.length === 0) return txtResponse(noDataMsg);
        
        const lang = phrases[0].lang;
        const formatted = phrases.map((phrase, index) => {
          const phrasePart = phrase.roman
            ? `"${phrase.text}" (${phrase.roman}) = ${phrase.meaning}`
            : `"${phrase.text}" = ${phrase.meaning}`;
          return index === 0 ? `${lang} → ${phrasePart}` : phrasePart;
        });
        return txtResponse(formatted.join(' · '));
      }

      if (route === 'sidequest') {
        const sidequests = pickN(travelData.sidequests, 3);
        return txtResponse(sidequests.length > 0 ? sidequests.join(' · ') : noDataMsg);
      }
    }

    // Status/Homepage route - returns JSON for homepage display (uses cached data)
    // Matches format expected by tazo-web homepage (includes emoji, forecast, etc.)
    if (route === 'status' || route === 'homepage') {
      let weatherData = null;
      if (locationData.weather) {
        const { condition, desc, tempC, feelsLikeC, windKmh, humidity } = locationData.weather;
        weatherData = {
          emoji: getWeatherEmoji(condition, isNightTime()),
          condition: desc,
          tempC,
          tempF: Math.round(tempC * 9 / 5 + 32),
          feelsC: feelsLikeC,
          feelsF: Math.round(feelsLikeC * 9 / 5 + 32),
          wind: windKmh,
          humidity,
        };
      }

      // Format time with timezone
      let timeStr = null;
      if (locationData.timezone) {
        try {
          timeStr = new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: locationData.timezone,
          });
        } catch (error) {
          // Invalid timezone, skip
        }
      }

      return jsonResponse({
        location: locationData.location?.name || null,
        time: timeStr,
        timezone: locationData.timezone,
        weather: weatherData,
        forecast: locationData.forecast,
      });
    }

    if (route === 'json') {
      return jsonResponse({
        rtirl: locationData.rtirl.raw,
        lat: roundCoordinate(lat),
        lon: roundCoordinate(lon),
        updatedAt: locationData.rtirl.updatedAt,
      });
    }

    // Heartrate stats route
    if (route === 'hr' || route === 'heartrate') {
      const stats = await getHeartrateStats();
      
      if (!stats.hasData) {
        return txtResponse('Heart rate data not available');
      }

      const parts: string[] = [];
      
      if (stats.current) {
        const currentText = stats.current.age === 'current'
          ? `${stats.current.bpm} BPM`
          : `${stats.current.bpm} BPM (${stats.current.age} ago)`;
        parts.push(`Current: ${currentText}`);
      } else {
        parts.push('Current: Not available');
      }

      if (stats.min) {
        parts.push(`Min: ${stats.min.bpm} (${stats.min.age} ago)`);
      }

      if (stats.max) {
        parts.push(`Max: ${stats.max.bpm} (${stats.max.age} ago)`);
      }

      if (stats.avg !== null) {
        parts.push(`Avg: ${stats.avg}`);
      }

      return txtResponse(parts.join(' | '));
    }

    // Speed stats route
    if (route === 'speed') {
      const stats = await getSpeedStats();
      
      if (!stats.hasData) {
        return txtResponse('Speed data not available');
      }

      const parts: string[] = [];
      
      if (stats.current) {
        const currentText = stats.current.age === 'current'
          ? `${Math.round(stats.current.speed)} km/h`
          : `${Math.round(stats.current.speed)} km/h (${stats.current.age} ago)`;
        parts.push(`Current: ${currentText}`);
      } else {
        parts.push('Current: Not available');
      }

      if (stats.max) {
        parts.push(`Max: ${Math.round(stats.max.speed)} km/h (${stats.max.age} ago)`);
      }

      return txtResponse(parts.join(' | '));
    }

    // Altitude stats route
    if (route === 'altitude' || route === 'elevation') {
      const stats = await getAltitudeStats();
      
      if (!stats.hasData) {
        return txtResponse('Altitude data not available');
      }

      const parts: string[] = [];
      
      if (stats.current) {
        const currentText = stats.current.age === 'current'
          ? `${stats.current.altitude} m`
          : `${stats.current.altitude} m (${stats.current.age} ago)`;
        parts.push(`Current: ${currentText}`);
      } else {
        parts.push('Current: Not available');
      }

      if (stats.highest) {
        parts.push(`Highest: ${stats.highest.altitude} m (${stats.highest.age} ago)`);
      }

      if (stats.lowest) {
        parts.push(`Lowest: ${stats.lowest.altitude} m (${stats.lowest.age} ago)`);
      }

      return txtResponse(parts.join(' | '));
    }

    // Combined stats route
    if (route === 'stats') {
      const [hrStats, speedStats, altStats, distance, countries, cities] = await Promise.all([
        getHeartrateStats(),
        getSpeedStats(),
        getAltitudeStats(),
        getDistanceTraveled(),
        getCountriesVisited(),
        getCitiesVisited(),
      ]);

      const parts: string[] = [];

      // Location
      if (locationData.location?.name) {
        parts.push(`Location: ${locationData.location.name}`);
      }

      // Speed
      if (speedStats.current && speedStats.current.age === 'current') {
        parts.push(`Speed: ${Math.round(speedStats.current.speed)} km/h`);
      }

      // Altitude
      if (altStats.current && altStats.current.age === 'current') {
        parts.push(`Altitude: ${altStats.current.altitude} m`);
      }

      // Heartrate
      if (hrStats.current && hrStats.current.age === 'current') {
        parts.push(`HR: ${hrStats.current.bpm} BPM`);
      }

      // Distance
      if (distance !== null) {
        parts.push(`Distance: ${distance} km`);
      }

      // Countries/Cities
      if (countries.length > 0) {
        parts.push(`Countries: ${countries.length}`);
      }
      if (cities.length > 0) {
        parts.push(`Cities: ${cities.length}`);
      }

      return txtResponse(parts.length > 0 ? parts.join(' | ') : 'No stats available');
    }

    // Debug route
    if (route === 'debug') {
      return jsonResponse({
        rtirl: { raw: locationData.rtirl.raw, lat: roundCoordinate(lat), lon: roundCoordinate(lon), updatedAt: locationData.rtirl.updatedAt },
        query: q || null,
        timestamp: new Date().toISOString(),
        cacheAge: Date.now() - locationData.cachedAt,
        availableRoutes: [
          'status - Raw GPS data',
          'json - Full RTIRL JSON',
          'debug - This debug info',
          'weather - Current weather',
          'forecast - Weather forecast',
          'sun - Sunrise/sunset times',
          'time - Local time',
          'map - Google Maps link',
          'location - City-level location name',
          'hr - Heart rate stats',
          'speed - Speed stats',
          'altitude - Altitude stats',
          'stats - Combined stats',
        ],
      });
    }

    return txtResponse('Unknown route', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return txtResponse(message, 500);
  }
}
