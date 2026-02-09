import { NextRequest, NextResponse } from 'next/server';
import { cleanQuery, roundCoordinate, getDisplayLabel } from '@/utils/chat-utils';
import { fetchLocationFromLocationIQ, fetchWeatherAndTimezoneFromOpenWeatherMap } from '@/utils/api-utils';
import { formatLocationForChat, getCityLocationForChat, pickN } from '@/utils/chat-utils';
import { getTravelData } from '@/utils/travel-data';
import { handleSizeRanking, getSizeRouteConfig, isSizeRoute } from '@/utils/size-ranking';
import type { LocationData } from '@/utils/location-utils';

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

// Fetch RTIRL GPS data
async function fetchRTIRLData() {
  const rtirlKey = process.env.NEXT_PUBLIC_RTIRL_PULL_KEY;
  if (!rtirlKey) {
    throw new Error('Missing RTIRL_PULL_KEY');
  }

  const response = await fetch(`https://rtirl.com/api/pull?key=${encodeURIComponent(rtirlKey)}`);
  if (!response.ok) {
    throw new Error(`RTIRL error ${response.status}`);
  }

  const data = await response.json();
  const baseLoc = data.location || {};
  const baseLat = baseLoc.latitude ?? data.lat ?? data.latitude ?? null;
  const baseLon = baseLoc.longitude ?? data.lon ?? data.lng ?? data.longitude ?? null;
  const updatedAt = data.updatedAt ?? data.reportedAt ?? null;

  return { lat: baseLat, lon: baseLon, updatedAt, raw: data };
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
  { params }: { params: { route: string } }
): Promise<NextResponse> {
  const route = params.route;
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
    const rtirlData = await fetchRTIRLData();
    const { lat, lon } = rtirlData;

    if (lat == null || lon == null) {
      return txtResponse('No RTIRL location available', 200);
    }

    // Location route - uses LocationIQ (same as overlay)
    if (route === 'location') {
      const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
      if (!locationiqKey) {
        return txtResponse('LocationIQ API not configured');
      }

      const locationResult = await fetchLocationFromLocationIQ(lat, lon, locationiqKey);
      if (locationResult.location) {
        const cityLocation = getCityLocationForChat(locationResult.location);
        return txtResponse(cityLocation || 'Location unavailable');
      }

      return txtResponse('');
    }

    // Weather route - uses OpenWeatherMap (same as overlay)
    if (route === 'weather') {
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
      if (!openweatherKey) {
        return txtResponse('Weather API not configured');
      }

      // Fetch current weather
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${openweatherKey}&units=metric`
      );
      
      if (!weatherRes.ok) {
        return txtResponse('Weather API unavailable');
      }

      const ow = await weatherRes.json();
      if (ow?.main?.temp == null) {
        return txtResponse('Weather data unavailable');
      }

      const condition = (ow.weather?.[0]?.main || '').toLowerCase();
      const desc = (ow.weather?.[0]?.description || '').toLowerCase();
      const tempC = Math.round(ow.main.temp);
      const tempF = Math.round(tempC * 9 / 5 + 32);
      const feelsLikeC = Math.round(ow.main.feels_like || tempC);
      const feelsLikeF = Math.round(feelsLikeC * 9 / 5 + 32);
      const windKmh = Math.round((ow.wind?.speed || 0) * 3.6);
      const humidity = ow.main.humidity || 0;
      const visibility = ow.visibility ? (ow.visibility / 1000) : null;

      // Check if it's night time (8 PM to 6 AM)
      const now = new Date();
      const hour = now.getHours();
      const isNight = hour >= 20 || hour < 6;
      const emojiMap: Record<string, string> = {
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
      const emoji = emojiMap[condition] || (isNight ? '🌙' : '🌤️');

      // Build notable conditions
      const notableConditions: string[] = [];
      if (windKmh > 30) notableConditions.push(`wind ${windKmh}km/h`);
      if (tempC > 35) {
        notableConditions.push(`very hot (feels like ${feelsLikeC}°C/${feelsLikeF}°F)`);
      } else if (tempC < 0) {
        notableConditions.push(`very cold (feels like ${feelsLikeC}°C/${feelsLikeF}°F)`);
      } else if (Math.abs(tempC - feelsLikeC) >= 5) {
        notableConditions.push(`feels like ${feelsLikeC}°C/${feelsLikeF}°F`);
      }
      if (humidity > 80) notableConditions.push(`high humidity (${humidity}%)`);
      else if (humidity < 30) notableConditions.push(`low humidity (${humidity}%)`);
      if (visibility !== null && visibility < 1) {
        notableConditions.push(`low visibility (${Math.round(visibility * 10) / 10}km)`);
      }

      let response = `${emoji} ${tempC}°C/${tempF}°F ${desc}`;
      if (notableConditions.length > 0) {
        response += `, ${notableConditions.join(', ')}`;
      }

      return txtResponse(response);
    }

    // Forecast route
    if (route === 'forecast') {
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
      if (!openweatherKey) {
        return txtResponse('Forecast API not configured');
      }

      const forecastRes = await fetch(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${openweatherKey}&units=metric`
      );

      if (!forecastRes.ok) {
        return txtResponse('Forecast API unavailable');
      }

      const fc = await forecastRes.json();
      if (!fc?.list || !Array.isArray(fc.list) || fc.list.length === 0) {
        return txtResponse('No forecast data available');
      }

      // Group by day and get today/tomorrow
      const dailyForecasts = new Map<string, typeof fc.list>();
      for (const item of fc.list) {
        if (!item?.dt || !item?.main?.temp) continue;
        const forecastTime = new Date(item.dt * 1000);
        const dateStr = forecastTime.toLocaleDateString('en-US', { weekday: 'short' });
        if (!dailyForecasts.has(dateStr)) {
          dailyForecasts.set(dateStr, []);
        }
        dailyForecasts.get(dateStr)!.push(item);
      }

      const out: string[] = [];
      let count = 0;
      for (const [dateStr, items] of dailyForecasts) {
        if (count >= 2) break;
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

        const minTempF = Math.round(minTempC * 9 / 5 + 32);
        const maxTempF = Math.round(maxTempC * 9 / 5 + 32);
        const condition = items[0]?.weather?.[0]?.main?.toLowerCase() || '';
        const emojiMap: Record<string, string> = {
          clear: '☀️',
          clouds: '☁️',
          rain: '🌧️',
          drizzle: '🌦️',
          thunderstorm: '⛈️',
          snow: '❄️',
        };
        const emoji = emojiMap[condition] || '🌤️';

        out.push(`${emoji} ${dateLabel} ${minTempC}-${maxTempC}°C/${minTempF}-${maxTempF}°F`);
        count++;
      }

      return txtResponse(out.length > 0 ? out.join(' | ') : 'No forecast data available');
    }

    // Sun route (sunrise/sunset)
    if (route === 'sun') {
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
      if (!openweatherKey) {
        return txtResponse('Sun API not configured');
      }

      const weatherData = await fetchWeatherAndTimezoneFromOpenWeatherMap(lat, lon, openweatherKey);
      if (!weatherData?.timezone) {
        return txtResponse('Timezone unavailable');
      }

      // Fetch weather for sunrise/sunset
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${openweatherKey}&units=metric`
      );

      if (!weatherRes.ok || !weatherRes.json) {
        return txtResponse('Sun data unavailable');
      }

      const ow = await weatherRes.json();
      if (!ow?.sys?.sunrise || !ow?.sys?.sunset) {
        return txtResponse('Sunrise/sunset data unavailable');
      }

      const sunriseUtc = new Date(ow.sys.sunrise * 1000);
      const sunsetUtc = new Date(ow.sys.sunset * 1000);
      const sunriseStr = sunriseUtc.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: weatherData.timezone,
      });
      const sunsetStr = sunsetUtc.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: weatherData.timezone,
      });

      const sunriseIsTomorrow = sunriseUtc.getTime() > sunsetUtc.getTime();
      return txtResponse(
        sunriseIsTomorrow
          ? `🌇 Sunset ${sunsetStr}, 🌅 Sunrise ${sunriseStr}`
          : `🌅 Sunrise ${sunriseStr}, 🌇 Sunset ${sunsetStr}`
      );
    }

    // Time route
    if (route === 'time') {
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;
      if (!openweatherKey) {
        return txtResponse('Timezone API not configured');
      }

      const weatherData = await fetchWeatherAndTimezoneFromOpenWeatherMap(lat, lon, openweatherKey);
      if (weatherData?.timezone) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: weatherData.timezone,
        });
        const dateStr = now.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: weatherData.timezone,
        });
        return txtResponse(`${timeStr} on ${dateStr} (${weatherData.timezone})`);
      }

      return txtResponse('Time unavailable');
    }

    // Map route
    if (route === 'map') {
      const roundedLat = roundCoordinate(lat);
      const roundedLon = roundCoordinate(lon);
      const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundedLat},${roundedLon}`)}`;
      return txtResponse(mapUrl);
    }

    // Travel routes (food, phrase, sidequest)
    if (route === 'food' || route === 'phrase' || route === 'sidequest') {
      const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
      let countryCode: string | null = null;

      if (locationiqKey) {
        const locationResult = await fetchLocationFromLocationIQ(lat, lon, locationiqKey);
        countryCode = locationResult.location?.countryCode || null;
      }

      const travelData = getTravelData(countryCode);

      if (route === 'food') {
        const foods = pickN(travelData.foods, 3);
        return txtResponse(foods.length > 0 ? foods.join(' · ') : 'No local data for this country yet');
      }

      if (route === 'phrase') {
        const phrases = pickN(travelData.phrases, 3);
        if (phrases.length === 0) {
          return txtResponse('No local data for this country yet');
        }
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
        return txtResponse(sidequests.length > 0 ? sidequests.join(' · ') : 'No local data for this country yet');
      }
    }

    // Status/JSON routes
    if (route === 'status' || route === 'homepage') {
      const locationiqKey = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
      const openweatherKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY;

      let locationName = '';
      if (locationiqKey) {
        const locationResult = await fetchLocationFromLocationIQ(lat, lon, locationiqKey);
        locationName = getCityLocationForChat(locationResult.location);
      }

      let weatherData = null;
      let timezone = null;
      if (openweatherKey) {
        const weatherResult = await fetchWeatherAndTimezoneFromOpenWeatherMap(lat, lon, openweatherKey);
        if (weatherResult?.weather) {
          weatherData = {
            tempC: weatherResult.weather.temp,
            tempF: Math.round(weatherResult.weather.temp * 9 / 5 + 32),
            desc: weatherResult.weather.desc,
          };
        }
        timezone = weatherResult?.timezone || null;
      }

      return jsonResponse({
        location: locationName || null,
        time: timezone ? new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }) : null,
        timezone,
        weather: weatherData,
      });
    }

    if (route === 'json') {
      return jsonResponse({
        rtirl: rtirlData.raw,
        lat: roundCoordinate(lat),
        lon: roundCoordinate(lon),
        updatedAt: rtirlData.updatedAt,
      });
    }

    // Debug route
    if (route === 'debug') {
      return jsonResponse({
        rtirl: { raw: rtirlData.raw, lat: roundCoordinate(lat), lon: roundCoordinate(lon), updatedAt: rtirlData.updatedAt },
        query: q || null,
        timestamp: new Date().toISOString(),
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
        ],
      });
    }

    return txtResponse('Unknown route', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return txtResponse(message, 500);
  }
}
