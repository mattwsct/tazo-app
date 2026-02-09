import { NextRequest, NextResponse } from 'next/server';
import { cleanQuery, roundCoordinate, getMapLocationString, getCountryNameFromCode } from '@/utils/chat-utils';
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
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { kv } from '@vercel/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';
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

  // Stats routes (no RTIRL required - use KV storage)
  if (route === 'hr' || route === 'heartrate') {
    const stats = await getHeartrateStats();
    
    // Debug logging (can be removed later)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Chat HR] Stats result:', JSON.stringify(stats, null, 2));
    }
    
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

  // Routes that require location data
  try {
    // Get settings from KV (same as overlay) - needed for location/map commands
    const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
    const displayMode = settings.locationDisplay;
    
    // Use persistent location storage (always available, even if stale)
    // This ensures chat commands work even if LocationIQ is temporarily unavailable
    const persistentLocation = await getPersistentLocation();
    
    // Fallback: try to get fresh location data if persistent storage is empty
    let locationData = null;
    let lat: number | null = null;
    let lon: number | null = null;
    
    if (persistentLocation) {
      lat = persistentLocation.rtirl.lat;
      lon = persistentLocation.rtirl.lon;
    } else {
      // No persistent location - try to fetch fresh (for weather/forecast/time routes)
      const freshData = await getLocationData();
      if (freshData && freshData.rtirl.lat && freshData.rtirl.lon) {
        lat = freshData.rtirl.lat;
        lon = freshData.rtirl.lon;
        locationData = freshData;
      }
    }
    
    // Location route - uses overlay settings to match overlay display
    if (route === 'location') {
      // If hidden, return hidden message
      if (displayMode === 'hidden') {
        return txtResponse('Location is hidden');
      }
      
      // Use persistent location if available
      if (persistentLocation && persistentLocation.location) {
        const rawLocation = persistentLocation.location;
        
        // If custom mode, don't use customLocation - just use country if visible
        if (displayMode === 'custom') {
          if (rawLocation.countryCode) {
            const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
            return txtResponse(countryName || 'Location unavailable');
          }
          return txtResponse('Location is hidden');
        }
        
        // Use formatLocation with same displayMode as overlay
        const formatted = formatLocation(rawLocation, displayMode);
        const parts: string[] = [];
        if (formatted.primary && formatted.primary.trim()) parts.push(formatted.primary.trim());
        if (formatted.secondary && formatted.secondary.trim()) parts.push(formatted.secondary.trim());
        
        if (parts.length > 0) {
          return txtResponse(parts.join(', '));
        }
        
        // Fallback: if formatLocation returned empty, try to get any available location name
        // This handles edge cases where formatLocation filters out valid names
        const fallbackParts: string[] = [];
        if (rawLocation.neighbourhood) fallbackParts.push(rawLocation.neighbourhood);
        else if (rawLocation.suburb) fallbackParts.push(rawLocation.suburb);
        else if (rawLocation.city) fallbackParts.push(rawLocation.city);
        else if (rawLocation.town) fallbackParts.push(rawLocation.town);
        else if (rawLocation.municipality) fallbackParts.push(rawLocation.municipality);
        else if (rawLocation.state) fallbackParts.push(rawLocation.state);
        else if (rawLocation.province) fallbackParts.push(rawLocation.province);
        
        if (rawLocation.countryCode && fallbackParts.length > 0) {
          const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
          if (countryName) fallbackParts.push(countryName);
        }
        
        if (fallbackParts.length > 0) {
          return txtResponse(fallbackParts.join(', '));
        }
      }
      
      return txtResponse('Location unavailable');
    }

    // Weather route - uses cached data (needs fresh weather, not just location)
    if (route === 'weather') {
      // Try to get fresh location data for weather (weather changes frequently)
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

      // Get timezone from cached location data (try fresh first)
      const freshData = locationData || await getLocationData();
      const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
      if (!timezone) {
        return txtResponse('Timezone unavailable for forecast');
      }

      // Forecast needs full data, fetch fresh
      // Use coordinates from persistent location or fresh data
      const forecastLat = lat !== null ? lat : (persistentLocation?.rtirl.lat || null);
      const forecastLon = lon !== null ? lon : (persistentLocation?.rtirl.lon || null);
      
      if (forecastLat === null || forecastLon === null) {
        return txtResponse('No location available for forecast');
      }
      
      const fc = await fetchForecast(forecastLat, forecastLon, openweatherKey!);
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
      // Try to get fresh data for sunrise/sunset (needs weather API)
      const freshData = locationData || await getLocationData();
      if (!freshData || !freshData.timezone || !freshData.sunriseSunset) {
        return txtResponse('Sunrise/sunset data unavailable');
      }

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

      const sunriseIsTomorrow = sunriseUtc.getTime() > sunsetUtc.getTime();
      return txtResponse(
        sunriseIsTomorrow
          ? `🌇 Sunset ${sunsetStr}, 🌅 Sunrise ${sunriseStr}`
          : `🌅 Sunrise ${sunriseStr}, 🌇 Sunset ${sunsetStr}`
      );
    }

    // Time route - uses cached timezone (can use persistent location)
    if (route === 'time') {
      // Try fresh data first, fallback to persistent location
      const freshData = locationData || await getLocationData();
      const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
      if (!timezone) {
        return txtResponse('Time unavailable');
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone,
      });
      return txtResponse(`${timeStr} on ${dateStr} (${timezone})`);
    }

    // Map route - uses overlay settings to match overlay display
    if (route === 'map') {
      // If hidden, return hidden message
      if (displayMode === 'hidden') {
        return txtResponse('Map is hidden');
      }
      
      // Use persistent location if available
      if (persistentLocation && persistentLocation.location) {
        const rawLocation = persistentLocation.location;
        
        // If custom mode, don't use customLocation - just use country if visible
        if (displayMode === 'custom') {
          if (rawLocation.countryCode) {
            const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
            if (countryName) {
              const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(countryName)}`;
              return txtResponse(mapUrl);
            }
          }
          return txtResponse('Map is hidden');
        }
        
        // Use formatLocation with same displayMode as overlay
        const formatted = formatLocation(rawLocation, displayMode);
        const parts: string[] = [];
        if (formatted.primary) parts.push(formatted.primary);
        if (formatted.secondary) parts.push(formatted.secondary);
        
        if (parts.length > 0) {
          const mapLocation = parts.join(', ');
          const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapLocation)}`;
          return txtResponse(mapUrl);
        }
      }
      
      // Fallback to coordinates if no location data
      if (lat !== null && lon !== null) {
        const roundedLat = roundCoordinate(lat);
        const roundedLon = roundCoordinate(lon);
        const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${roundedLat},${roundedLon}`)}`;
        return txtResponse(mapUrl);
      }
      
      return txtResponse('Map is hidden');
    }

    // Travel routes (food, phrase, sidequest) - uses persistent location country code
    if (route === 'food' || route === 'phrase' || route === 'sidequest') {
      const countryCode = persistentLocation?.location?.countryCode || null;
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
      // Try to get fresh data for weather/forecast (they change frequently)
      const freshData = locationData || await getLocationData();
      
      let weatherData = null;
      if (freshData?.weather) {
        const { condition, desc, tempC, feelsLikeC, windKmh, humidity } = freshData.weather;
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

      // Format time with timezone (can use persistent location)
      const timezone = freshData?.timezone || persistentLocation?.location?.timezone || null;
      let timeStr = null;
      if (timezone) {
        try {
          timeStr = new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
          });
        } catch (error) {
          // Invalid timezone, skip
        }
      }

      // Get location name from persistent location (formatted with settings)
      let locationName: string | null = null;
      if (persistentLocation && persistentLocation.location) {
        const rawLocation = persistentLocation.location;
        if (displayMode !== 'hidden') {
          if (displayMode === 'custom') {
            // Custom mode - just use country
            if (rawLocation.countryCode) {
              locationName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
            }
          } else {
            // Format location based on display mode
            const formatted = formatLocation(rawLocation, displayMode);
            const parts: string[] = [];
            if (formatted.primary) parts.push(formatted.primary);
            if (formatted.secondary) parts.push(formatted.secondary);
            if (parts.length > 0) {
              locationName = parts.join(', ');
            }
          }
        }
      }

      return jsonResponse({
        location: locationName,
        time: timeStr,
        timezone: timezone,
        weather: weatherData,
        forecast: freshData?.forecast || null,
      });
    }

    // JSON route removed for privacy

    // Combined stats route (needs location data)
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

      // Location (formatted with settings)
      if (persistentLocation && persistentLocation.location && displayMode !== 'hidden') {
        const rawLocation = persistentLocation.location;
        if (displayMode === 'custom') {
          // Custom mode - just use country
          if (rawLocation.countryCode) {
            const countryName = rawLocation.country || getCountryNameFromCode(rawLocation.countryCode);
            if (countryName) {
              parts.push(`Location: ${countryName}`);
            }
          }
        } else {
          // Format location based on display mode
          const formatted = formatLocation(rawLocation, displayMode);
          const locationParts: string[] = [];
          if (formatted.primary) locationParts.push(formatted.primary);
          if (formatted.secondary) locationParts.push(formatted.secondary);
          if (locationParts.length > 0) {
            parts.push(`Location: ${locationParts.join(', ')}`);
          }
        }
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
      const debugData: Record<string, unknown> = {
        query: q || null,
        timestamp: new Date().toISOString(),
      };
      
      if (persistentLocation) {
        debugData.persistentLocation = {
          location: persistentLocation.location,
          rtirl: { 
            lat: roundCoordinate(persistentLocation.rtirl.lat), 
            lon: roundCoordinate(persistentLocation.rtirl.lon), 
            updatedAt: persistentLocation.rtirl.updatedAt 
          },
          updatedAt: persistentLocation.updatedAt,
        };
      }
      
      if (locationData) {
        debugData.cachedLocation = {
          rtirl: { 
            raw: locationData.rtirl.raw, 
            lat: roundCoordinate(lat), 
            lon: roundCoordinate(lon), 
            updatedAt: locationData.rtirl.updatedAt 
          },
          cacheAge: Date.now() - locationData.cachedAt,
        };
      }
      
      debugData.availableRoutes = [
        'status - Raw GPS data',
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
      ];
      
      debugData.availableRoutes = [
        'status - Raw GPS data',
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
      ];
      
      return jsonResponse(debugData);
    }

    return txtResponse('Unknown route', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return txtResponse(message, 500);
  }
}
