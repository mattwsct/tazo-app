import { NextRequest, NextResponse } from 'next/server';
import { cleanQuery, roundCoordinate, getCountryNameFromCode } from '@/utils/chat-utils';
import { pickN } from '@/utils/chat-utils';
import { getTravelData, getAvailableCountries } from '@/utils/travel-data';
import { handleSizeRanking, getSizeRouteConfig, isSizeRoute } from '@/utils/size-ranking';
import {
  getWeatherEmoji,
  isNightTime,
  formatTemperature,
  getNotableConditions,
  fetchForecast,
} from '@/utils/weather-chat';
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { kv } from '@vercel/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';
import { getSpeedStats, getAltitudeStats } from '@/utils/stats-storage';

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

// Helper to calculate moon phase
function calculateMoonPhase(): { name: string; emoji: string; illumination: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  // Simplified moon phase calculation (approximate)
  const daysSinceNewMoon = (year * 365.25 + month * 30.44 + day) % 29.53;
  const illumination = Math.abs(Math.cos((daysSinceNewMoon / 29.53) * 2 * Math.PI)) * 100;
  
  let phase: string;
  let emoji: string;
  
  if (daysSinceNewMoon < 1.84) {
    phase = 'New Moon';
    emoji = '🌑';
  } else if (daysSinceNewMoon < 5.53) {
    phase = 'Waxing Crescent';
    emoji = '🌒';
  } else if (daysSinceNewMoon < 9.22) {
    phase = 'First Quarter';
    emoji = '🌓';
  } else if (daysSinceNewMoon < 12.91) {
    phase = 'Waxing Gibbous';
    emoji = '🌔';
  } else if (daysSinceNewMoon < 16.61) {
    phase = 'Full Moon';
    emoji = '🌕';
  } else if (daysSinceNewMoon < 20.30) {
    phase = 'Waning Gibbous';
    emoji = '🌖';
  } else if (daysSinceNewMoon < 23.99) {
    phase = 'Last Quarter';
    emoji = '🌗';
  } else {
    phase = 'Waning Crescent';
    emoji = '🌘';
  }
  
  return { name: phase, emoji, illumination: Math.round(illumination) };
}

// Helper to get moon emoji from illumination percentage
function getMoonEmoji(illumination: number): string {
  if (illumination < 2) return '🌑'; // New Moon
  if (illumination < 25) return '🌒'; // Waxing Crescent
  if (illumination < 48) return '🌓'; // First Quarter
  if (illumination < 52) return '🌔'; // Waxing Gibbous
  if (illumination < 75) return '🌕'; // Full Moon
  if (illumination < 98) return '🌖'; // Waning Gibbous
  if (illumination < 100) return '🌗'; // Last Quarter
  return '🌘'; // Waning Crescent
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
  // Heart rate command removed - not working reliably

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

      const feelsF = Math.round(feelsLikeC * 9 / 5 + 32);
      
      // Enhanced weather response with feels like and more details
      const parts: string[] = [];
      parts.push(`${emoji} ${formatTemperature(tempC)} ${desc}`);
      
      if (Math.abs(feelsLikeC - tempC) > 1) {
        parts.push(`feels like ${formatTemperature(feelsLikeC)}`);
      }
      
      // Weather alerts/warnings for severe conditions
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
      
      // Calculate tomorrow's date in location's timezone
      const tomorrowDate = new Date(now);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: timezone });
      
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
        if (sortedDates.length > 0) {
          // Start from first available date
          todayIndex = 0;
        } else {
          return txtResponse('No forecast data available');
        }
      }

      const out: string[] = [];
      let count = 0;
      
      // Process up to 5 days (enhanced from 2)
      for (let i = todayIndex; i < sortedDates.length && count < 5; i++) {
        const dateStr = sortedDates[i];
        const items = dailyForecasts.get(dateStr)!;
        
        let dateLabel: string;
        // Compare dateStr directly with todayStr and tomorrowStr to determine label
        if (dateStr === todayStr) {
          dateLabel = 'Today';
        } else if (dateStr === tomorrowStr) {
          dateLabel = 'Tomorrow';
        } else {
          // Format date as "Mon Jan 15" - use first forecast item's timestamp to get correct date in timezone
          const firstItem = items[0];
          if (firstItem?.dt) {
            const date = new Date(firstItem.dt * 1000);
            dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
          } else {
            // Fallback: parse dateStr (YYYY-MM-DD) and format
            const [year, month, day] = dateStr.split('-').map(Number);
            const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
            dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
          }
        }

        let minTempC = Infinity;
        let maxTempC = -Infinity;
        let conditions: string[] = [];
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
            windSpeed = Math.max(windSpeed, item.wind.speed * 3.6); // Convert m/s to km/h
          }
          if (item?.main?.humidity) {
            humidity = Math.max(humidity, item.main.humidity);
          }
        }

        if (minTempC === Infinity || maxTempC === -Infinity) continue;

        // Use most common condition or first item's condition
        const condition = conditions[0] || items[0]?.weather?.[0]?.main?.toLowerCase() || '';
        const emoji = getWeatherEmoji(condition);
        const minTempF = Math.round(minTempC * 9 / 5 + 32);
        const maxTempF = Math.round(maxTempC * 9 / 5 + 32);

        // Format: show single temp if min === max, otherwise range
        const tempRange = minTempC === maxTempC 
          ? `${minTempC}°C/${minTempF}°F`
          : `${minTempC}-${maxTempC}°C/${minTempF}-${maxTempF}°F`;

        // Enhanced forecast with more details
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

    // Sun route (sunrise/sunset) - uses cached data
    if (route === 'sun') {
      // Try to get fresh data for sunrise/sunset (needs weather API)
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

      // Calculate time until sunrise/sunset
      const timeUntilSunrise = sunriseUtc.getTime() - now.getTime();
      const timeUntilSunset = sunsetUtc.getTime() - now.getTime();
      
      const formatTimeUntil = (ms: number): string => {
        if (ms < 0) {
          // Already passed, calculate next occurrence
          const nextMs = ms + (24 * 60 * 60 * 1000);
          const hours = Math.floor(nextMs / (60 * 60 * 1000));
          const minutes = Math.floor((nextMs % (60 * 60 * 1000)) / (60 * 1000));
          return `in ${hours}h ${minutes}m (tomorrow)`;
        }
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `in ${hours}h ${minutes}m`;
      };

      const sunriseUntil = formatTimeUntil(timeUntilSunrise);
      const sunsetUntil = formatTimeUntil(timeUntilSunset);

      const sunriseIsTomorrow = sunriseUtc.getTime() > sunsetUtc.getTime();
      const parts: string[] = [];
      
      if (sunriseIsTomorrow) {
        parts.push(`🌇 Sunset ${sunsetStr} (${sunsetUntil})`);
        parts.push(`🌅 Sunrise ${sunriseStr} (${sunriseUntil})`);
      } else {
        parts.push(`🌅 Sunrise ${sunriseStr} (${sunriseUntil})`);
        parts.push(`🌇 Sunset ${sunsetStr} (${sunsetUntil})`);
      }

      return txtResponse(parts.join(' · '));
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

    // Travel routes (food, phrase, tips, emergency, flirt, sex, insults/insult) - uses persistent location country code or optional country code from query
    if (route === 'food' || route === 'phrase' || route === 'tips' || route === 'emergency' || route === 'flirt' || route === 'sex' || route === 'insults' || route === 'insult') {
      // Check if a country code was provided in the query (e.g., !food AU or !phrase JP)
      const queryCountryCode = q ? q.trim().toUpperCase() : null;
      const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;
      
      // Validate country code if provided
      if (requestedCountryCode) {
        const availableCountries = getAvailableCountries();
        const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
        if (!isValidCode) {
          return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
        }
      }
      
      // Use requested country code if provided, otherwise use persistent location
      const countryCode = requestedCountryCode || persistentLocation?.location?.countryCode || null;
      const countryName = requestedCountryCode 
        ? getCountryNameFromCode(requestedCountryCode)
        : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
      const travelData = getTravelData(countryCode);
      
      // Create a helpful message for countries without specific data
      const getNoDataMsg = (type: 'food' | 'phrase' | 'tips' | 'emergency' | 'flirt' | 'sex' | 'insults') => {
        if (countryName && !travelData.isCountrySpecific) {
          const typeNames: Record<string, string> = {
            food: 'local food',
            phrase: 'local phrase',
            tips: 'cultural tips',
            emergency: 'emergency information',
            flirt: 'flirting phrases',
            sex: 'sexual phrases',
            insults: 'local insults'
          };
          return `No ${typeNames[type]} data available for ${countryName} yet. Use !countries to see available countries.`;
        }
        const typeNames: Record<string, string> = {
          food: 'food',
          phrase: 'phrase',
          tips: 'cultural tips',
          emergency: 'emergency information',
          flirt: 'flirting phrases',
          sex: 'sexual phrases',
          insults: 'local insults'
        };
        return `No ${typeNames[type]} data available. Specify a country code (e.g., !${route} JP) or use !countries to see available countries.`;
      };

      if (route === 'food') {
        const foods = pickN(travelData.foods, 3);
        if (foods.length === 0) {
          return txtResponse(getNoDataMsg('food'));
        }
        // Add note if using global data
        const note = !travelData.isCountrySpecific && countryName 
          ? ` (Global - no ${countryName} data yet)`
          : '';
        // Prepend country indicator if a specific country was requested
        const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
          ? `[${countryName}] `
          : '';
        return txtResponse(countryPrefix + foods.join(' · ') + note);
      }

      if (route === 'phrase') {
        const phrases = pickN(travelData.phrases, 3);
        if (phrases.length === 0) {
          return txtResponse(getNoDataMsg('phrase'));
        }
        
        const lang = phrases[0].lang;
        const formatted = phrases.map((phrase, index) => {
          const phrasePart = phrase.roman
            ? `"${phrase.text}" (${phrase.roman}) = ${phrase.meaning}`
            : `"${phrase.text}" = ${phrase.meaning}`;
          return index === 0 ? `${lang} → ${phrasePart}` : phrasePart;
        });
        
        // Add note if using global data
        const note = !travelData.isCountrySpecific && countryName 
          ? ` (Global - no ${countryName} phrases yet)`
          : '';
        // Prepend country indicator if a specific country was requested
        const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
          ? `[${countryName}] `
          : '';
        
        return txtResponse(countryPrefix + formatted.join(' · ') + note);
      }

      if (route === 'tips') {
        const tips = travelData.culturalTips || [];
        if (tips.length === 0) {
          return txtResponse(getNoDataMsg('tips'));
        }
        const selectedTips = pickN(tips, 3);
        // Prepend country indicator if a specific country was requested
        const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
          ? `[${countryName}] `
          : '';
        return txtResponse(countryPrefix + selectedTips.join(' · '));
      }

      if (route === 'emergency') {
        const emergencyInfo = travelData.emergencyInfo;
        
        if (!emergencyInfo) {
          return txtResponse(getNoDataMsg('emergency'));
        }
        
        const parts: string[] = [];
        
        // Prepend country indicator if country-specific data is available (same as other travel commands)
        if (travelData.isCountrySpecific && countryName) {
          parts.push(`[${countryName}]`);
        }
        
        // Add emergency phone numbers only (no duplication; works for all countries)
        // If country has police/ambulance/fire breakdown we show those; otherwise single phone line
        const phoneParts: string[] = [];
        const hasIndividual = emergencyInfo.police || emergencyInfo.ambulance || emergencyInfo.fire;
        if (hasIndividual) {
          if (emergencyInfo.police) phoneParts.push(`Police: ${emergencyInfo.police}`);
          if (emergencyInfo.ambulance) phoneParts.push(`Ambulance: ${emergencyInfo.ambulance}`);
          if (emergencyInfo.fire && emergencyInfo.fire !== emergencyInfo.ambulance) {
            phoneParts.push(`Fire: ${emergencyInfo.fire}`);
          }
        } else if (emergencyInfo.phone) {
          phoneParts.push(emergencyInfo.phone);
        }
        if (phoneParts.length > 0) {
          parts.push(phoneParts.join(' | '));
        }
        
        // Add Australian embassy contact (for all countries except Australia)
        if (emergencyInfo.australianEmbassy && countryCode !== 'AU') {
          parts.push(`AU Embassy: ${emergencyInfo.australianEmbassy}`);
        }
        
        if (parts.length === 0) {
          return txtResponse(getNoDataMsg('emergency'));
        }
        
        const response = parts.join(' | ');
        return txtResponse(response || getNoDataMsg('emergency'));
      }

      if (route === 'flirt') {
        const flirtPhrases = travelData.flirt || [];
        if (flirtPhrases.length === 0) {
          return txtResponse(getNoDataMsg('flirt'));
        }
        const selectedPhrases = pickN(flirtPhrases, 3);
        // Prepend country indicator if country-specific data is available (same as other travel commands)
        const countryPrefix = travelData.isCountrySpecific && countryName
          ? `[${countryName}] `
          : '';
        return txtResponse(countryPrefix + selectedPhrases.join(' · '));
      }

      if (route === 'sex') {
        const sexPhrases = travelData.sex || [];
        if (sexPhrases.length === 0) {
          return txtResponse(getNoDataMsg('sex'));
        }
        const selectedPhrases = pickN(sexPhrases, 3);
        // Prepend country indicator if country-specific data is available (same as other travel commands)
        const countryPrefix = travelData.isCountrySpecific && countryName
          ? `[${countryName}] `
          : '';
        return txtResponse(countryPrefix + selectedPhrases.join(' · '));
      }

      if (route === 'insults' || route === 'insult') {
        const insults = travelData.insults || [];
        if (insults.length === 0) {
          return txtResponse(getNoDataMsg('insults'));
        }
        const selectedInsults = pickN(insults, 3);
        // Prepend country indicator if country-specific data is available (same as other travel commands)
        const countryPrefix = travelData.isCountrySpecific && countryName
          ? `[${countryName}] `
          : '';
        return txtResponse(countryPrefix + selectedInsults.join(' · '));
      }
    }

    // Countries route - list all available countries
    if (route === 'countries') {
      const countries = getAvailableCountries();
      // Format as: JP (Japan), VN (Vietnam), ...
      const formatted = countries.map(c => `${c.code} (${c.name})`).join(', ');
      return txtResponse(`Available countries: ${formatted}`);
    }

    // Fact route - returns random fact about current or specified country, or random country if none specified
    if (route === 'fact' || route === 'facts') {
      // Check if a country code was provided in the query
      const queryCountryCode = q ? q.trim().toUpperCase() : null;
      const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;
      
      // Validate country code if provided
      if (requestedCountryCode) {
        const availableCountries = getAvailableCountries();
        const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
        if (!isValidCode) {
          return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
        }
      }
      
      // Determine country code: requested > persistent location > random country with facts
      let countryCode: string | null = requestedCountryCode || persistentLocation?.location?.countryCode || null;
      let countryName: string | null = null;
      
      // If no country code, pick a random country that has facts
      if (!countryCode) {
        const availableCountries = getAvailableCountries();
        const countriesWithFacts = availableCountries.filter(c => {
          const data = getTravelData(c.code);
          return data.facts && data.facts.length > 0;
        });
        
        if (countriesWithFacts.length > 0) {
          const randomCountry = pickN(countriesWithFacts, 1)[0];
          countryCode = randomCountry.code;
          countryName = randomCountry.name;
        } else {
          return txtResponse('No facts available. Use !countries to see available countries.');
        }
      } else {
        // Get country name for the selected country
        countryName = requestedCountryCode 
          ? getCountryNameFromCode(requestedCountryCode)
          : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
      }
      
      const travelData = getTravelData(countryCode);
      const facts = travelData.facts || [];
      
      if (facts.length === 0) {
        const noFactMsg = countryName 
          ? `No facts available for ${countryName} yet. Use !countries to see available countries.`
          : 'No facts available. Specify a country code (e.g., !fact JP) or use !countries to see available countries.';
        return txtResponse(noFactMsg);
      }
      
      const selectedFact = pickN(facts, 1)[0];
      const countryPrefix = travelData.isCountrySpecific && countryName
        ? `[${countryName}] `
        : '';
      return txtResponse(`${countryPrefix}${selectedFact}`);
    }

    // Currency route - shows currency for current or specified country
    if (route === 'currency') {
      // Check if a country code was provided in the query
      const queryCountryCode = q ? q.trim().toUpperCase() : null;
      const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;
      
      // Validate country code if provided
      if (requestedCountryCode) {
        const availableCountries = getAvailableCountries();
        const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
        if (!isValidCode) {
          return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
        }
      }
      
      // Use requested country code if provided, otherwise use persistent location
      const countryCode = requestedCountryCode || persistentLocation?.location?.countryCode || null;
      const countryName = requestedCountryCode 
        ? getCountryNameFromCode(requestedCountryCode)
        : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
      const travelData = getTravelData(countryCode);
      
      if (!travelData.currency) {
        const noCurrencyMsg = countryName 
          ? `No currency data available for ${countryName} yet.`
          : 'No currency data available. Specify a country code (e.g., !currency JP)';
        return txtResponse(noCurrencyMsg);
      }
      
      const { name, symbol, code } = travelData.currency;
      const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
        ? `[${countryName}] `
        : '';
      return txtResponse(`${countryPrefix}${name} (${code}) ${symbol}`);
    }

    // Convert route - converts currency amounts
    // Usage: !convert <amount> [FROM] [TO]
    // Examples: !convert 1000 (local to USD/AUD), !convert 1000 AUD (AUD to USD), !convert 1000 AUD JPY (AUD to JPY)
    if (route === 'convert') {
      // Helper function to check if currency uses decimal places (ISO 4217 standard)
      const usesDecimals = (currencyCode: string): boolean => {
        const zeroDecimalCurrencies = [
          'JPY', // Japanese Yen
          'KRW', // South Korean Won
          'VND', // Vietnamese Dong
          'CLP', // Chilean Peso
          'IDR', // Indonesian Rupiah
          'IQD', // Iraqi Dinar
          'IRR', // Iranian Rial
          'ISK', // Icelandic Króna
          'KMF', // Comoro Franc
          'KPW', // North Korean Won
          'LAK', // Lao Kip
          'LBP', // Lebanese Pound
        ];
        return !zeroDecimalCurrencies.includes(currencyCode);
      };
      
      const parts = q.trim().split(/\s+/).filter(p => p);
      
      if (parts.length === 0) {
        return txtResponse('Usage: !convert <amount> [FROM] [TO] (e.g., !convert 1000, !convert 1,000.50 AUD, !convert 1000 AUD JPY)');
      }

      // Parse amount (first part) - remove commas, handle decimals
      const amountStr = parts[0].replace(/,/g, ''); // Remove commas
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        return txtResponse('Usage: !convert <amount> [FROM] [TO] (e.g., !convert 1000, !convert 1,000.50 AUD, !convert 1000 AUD JPY)');
      }

      // Parse currency codes (remaining parts, uppercase)
      const currencyCodes = parts.slice(1).map(p => p.toUpperCase());
      let fromCurrency: string | null = null;
      let toCurrency: string = 'USD'; // Default to USD

      if (currencyCodes.length === 0) {
        // No currencies specified - use local currency
        const countryCode = persistentLocation?.location?.countryCode || null;
        const travelData = getTravelData(countryCode);
        if (!travelData.currency) {
          const countryName = persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null);
          const noCurrencyMsg = countryName 
            ? `No currency data available for ${countryName} yet. Specify currencies: !convert ${amount} <FROM> [TO]`
            : 'No currency data available. Usage: !convert <amount> <FROM> [TO] (e.g., !convert 1000 AUD)';
          return txtResponse(noCurrencyMsg);
        }
        fromCurrency = travelData.currency.code;
        // If local currency is USD, default to AUD instead (more useful)
        if (fromCurrency === 'USD') {
          toCurrency = 'AUD';
        }
      } else if (currencyCodes.length === 1) {
        // One currency specified - FROM currency
        fromCurrency = currencyCodes[0];
        // If FROM is USD, default to AUD (more useful than USD to USD)
        if (fromCurrency === 'USD') {
          toCurrency = 'AUD';
        } else {
          toCurrency = 'USD';
        }
      } else if (currencyCodes.length >= 2) {
        // Two or more currencies specified - FROM and TO (or chain conversions)
        fromCurrency = currencyCodes[0];
        toCurrency = currencyCodes[currencyCodes.length - 1]; // Last currency is final destination
      }

      // Validate currency codes (3-letter ISO codes)
      if (fromCurrency && (fromCurrency.length !== 3 || !/^[A-Z]{3}$/.test(fromCurrency))) {
        return txtResponse(`Invalid currency code: ${fromCurrency}. Use 3-letter ISO codes (e.g., USD, EUR, JPY, AUD)`);
      }
      if (toCurrency.length !== 3 || !/^[A-Z]{3}$/.test(toCurrency)) {
        return txtResponse(`Invalid currency code: ${toCurrency}. Use 3-letter ISO codes (e.g., USD, EUR, JPY, AUD)`);
      }

      // If same currency, just format and return
      if (fromCurrency === toCurrency) {
        // Try to get currency symbol from travel data
        let symbol = '$';
        const allCountries = getAvailableCountries();
        for (const country of allCountries) {
          const data = getTravelData(country.code);
          if (data.currency?.code === fromCurrency) {
            symbol = data.currency.symbol;
            break;
          }
        }
        const formatted = usesDecimals(fromCurrency)
          ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : Math.round(amount).toLocaleString('en-US');
        return txtResponse(`${symbol}${formatted} ${fromCurrency}`);
      }

      // Helper function to fetch exchange rate between two currencies
      const fetchExchangeRate = async (from: string, to: string): Promise<number> => {
        const exchangeRateApiKey = process.env.EXCHANGERATE_API_KEY;
        let rate: number | null = null;
        let lastError: Error | null = null;
        
        // Try ExchangeRate-API first if API key is available (most reliable)
        if (exchangeRateApiKey) {
          try {
            const exchangeRateUrl = `https://v6.exchangerate-api.com/v6/${exchangeRateApiKey}/latest/${from}`;
            const exchangeRateResponse = await fetch(exchangeRateUrl, {
              next: { revalidate: 3600 } // Cache for 1 hour
            });
            
            if (exchangeRateResponse.ok) {
              const exchangeRateData = await exchangeRateResponse.json();
              if (exchangeRateData.result === 'success' && exchangeRateData.conversion_rates?.[to]) {
                rate = exchangeRateData.conversion_rates[to];
              } else {
                throw new Error('ExchangeRate-API returned invalid data');
              }
            } else {
              throw new Error(`ExchangeRate-API returned ${exchangeRateResponse.status}`);
            }
          } catch (exchangeRateError) {
            lastError = exchangeRateError instanceof Error ? exchangeRateError : new Error('ExchangeRate-API failed');
          }
        }
        
        // Try Frankfurter API (free, no API key required)
        if (!rate) {
          try {
            const frankfurterUrl = `https://api.frankfurter.dev/latest?from=${from}&to=${to}`;
            const frankfurterResponse = await fetch(frankfurterUrl, {
              next: { revalidate: 3600 } // Cache for 1 hour
            });
            
            if (frankfurterResponse.ok) {
              const frankfurterData = await frankfurterResponse.json();
              rate = frankfurterData.rates?.[to];
              
              if (!rate || typeof rate !== 'number') {
                throw new Error('Invalid rate data from Frankfurter');
              }
            } else {
              throw new Error(`Frankfurter API returned ${frankfurterResponse.status}`);
            }
          } catch (frankfurterError) {
            lastError = frankfurterError instanceof Error ? frankfurterError : new Error('Frankfurter API failed');
          }
        }
        
        // Fallback to exchangerate.host
        if (!rate) {
          try {
            const exchangeUrl = `https://api.exchangerate.host/latest?base=${from}&symbols=${to}`;
            const exchangeResponse = await fetch(exchangeUrl, {
              next: { revalidate: 3600 } // Cache for 1 hour
            });
            
            if (!exchangeResponse.ok) {
              throw new Error(`exchangerate.host returned ${exchangeResponse.status}`);
            }
            
            const exchangeData = await exchangeResponse.json();
            rate = exchangeData.rates?.[to];
            
            if (!rate || typeof rate !== 'number') {
              throw new Error('Invalid exchange rate data from exchangerate.host');
            }
          } catch (exchangeError) {
            lastError = exchangeError instanceof Error ? exchangeError : new Error('exchangerate.host failed');
          }
        }
        
        if (!rate) {
          throw lastError || new Error('All exchange rate APIs failed');
        }
        
        return rate;
      };

      // Handle multi-currency conversion chain
      try {
        let currentAmount = amount;
        let currentCurrency = fromCurrency;
        
        // Build conversion chain: [FROM, ...intermediates, TO]
        const conversionChain = currencyCodes.length >= 2 
          ? [fromCurrency, ...currencyCodes.slice(1)] 
          : [fromCurrency, toCurrency];
        
        // Convert through each step in the chain
        for (let i = 0; i < conversionChain.length - 1; i++) {
          const from = conversionChain[i];
          const to = conversionChain[i + 1];
          
          if (from === to) continue; // Skip if same currency
          
          const rate = await fetchExchangeRate(from, to);
          currentAmount = currentAmount * rate;
          currentCurrency = to;
        }
        
        // Format final result
        const finalCurrency = conversionChain[conversionChain.length - 1];
        const finalUsesDecimals = usesDecimals(finalCurrency);
        const fromUsesDecimals = usesDecimals(fromCurrency);
        
        const formattedAmount = fromUsesDecimals
          ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : Math.round(amount).toLocaleString('en-US');
        
        const formattedConverted = finalUsesDecimals
          ? currentAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : Math.round(currentAmount).toLocaleString('en-US');
        
        // Get currency symbols
        let fromSymbol = fromCurrency;
        let toSymbol = finalCurrency;
        const allCountries = getAvailableCountries();
        for (const country of allCountries) {
          const data = getTravelData(country.code);
          if (data.currency?.code === fromCurrency) {
            fromSymbol = data.currency.symbol;
          }
          if (data.currency?.code === finalCurrency) {
            toSymbol = data.currency.symbol;
          }
        }
        
        return txtResponse(`${fromSymbol}${formattedAmount} ${fromCurrency} = ${toSymbol}${formattedConverted} ${finalCurrency}`);
      } catch (error) {
        console.error('Currency conversion error:', error);
        return txtResponse(`Unable to fetch exchange rate for ${fromCurrency} to ${toCurrency}. Please try again later.`);
      }
    }

    // Fun commands (no RTIRL required)
    if (route === 'dice' || route === 'roll') {
      const parts = q.trim().split(/\s+/).filter(p => p);
      let sides = 6;
      let count = 1;
      
      if (parts.length > 0) {
        const first = parseInt(parts[0]);
        if (!isNaN(first) && first > 0) {
          if (first <= 100) {
            sides = first;
            if (parts.length > 1) {
              const second = parseInt(parts[1]);
              if (!isNaN(second) && second > 0 && second <= 10) {
                count = second;
              }
            }
          } else {
            count = Math.min(first, 10);
          }
        }
      }
      
      const results: number[] = [];
      for (let i = 0; i < count; i++) {
        results.push(Math.floor(Math.random() * sides) + 1);
      }
      
      if (count === 1) {
        return txtResponse(`🎲 Rolled ${results[0]} (d${sides})`);
      } else {
        const sum = results.reduce((a, b) => a + b, 0);
        return txtResponse(`🎲 Rolled ${results.join(', ')} = ${sum} (${count}d${sides})`);
      }
    }

    if (route === 'coin' || route === 'flip') {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
      return txtResponse(`🪙 ${result}`);
    }

    if (route === '8ball' || route === 'magic8ball') {
      const responses = [
        'It is certain',
        'Without a doubt',
        'Yes definitely',
        'You may rely on it',
        'As I see it, yes',
        'Most likely',
        'Outlook good',
        'Yes',
        'Signs point to yes',
        'Reply hazy, try again',
        'Ask again later',
        'Better not tell you now',
        'Cannot predict now',
        'Concentrate and ask again',
        "Don't count on it",
        'My reply is no',
        'My sources say no',
        'Outlook not so good',
        'Very doubtful',
        'No'
      ];
      const response = responses[Math.floor(Math.random() * responses.length)];
      return txtResponse(`🎱 ${response}`);
    }

    if (route === 'random') {
      const parts = q.trim().split(/\s+/).filter(p => p);
      if (parts.length === 0) {
        return txtResponse('Usage: !random <min> <max> (e.g., !random 1 100)');
      }
      
      const min = parseInt(parts[0]);
      const max = parts.length > 1 ? parseInt(parts[1]) : min;
      
      if (isNaN(min) || isNaN(max) || min > max || min < 0 || max > 1000000) {
        return txtResponse('Usage: !random <min> <max> (e.g., !random 1 100)');
      }
      
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      return txtResponse(`🎲 Random: ${result} (${min}-${max})`);
    }

    // Temperature conversion
    if (route === 'temp' || route === 'temperature') {
      const input = q.trim();
      if (!input) {
        return txtResponse('Usage: !temp <value> [unit] (e.g., !temp 25, !temp 77 f, !temp 22c, !temp 70f)');
      }
      
      // Try to parse formats like "22c", "70f", "22 c", "70 f", or just "22"
      let value: number;
      let unit: string = 'c'; // Default to Celsius
      
      // Check if unit is attached to number (e.g., "22c", "70f")
      const attachedUnitMatch = input.match(/^([+-]?\d+\.?\d*)\s*([cf]|celsius|fahrenheit)$/i);
      if (attachedUnitMatch) {
        value = parseFloat(attachedUnitMatch[1]);
        unit = attachedUnitMatch[2].toLowerCase();
        if (unit === 'celsius') unit = 'c';
        if (unit === 'fahrenheit') unit = 'f';
      } else {
        // Try space-separated format (e.g., "22 c", "70 f")
        const parts = input.split(/\s+/).filter(p => p);
        value = parseFloat(parts[0]);
        if (parts.length > 1) {
          const unitPart = parts[1].toLowerCase();
          if (unitPart === 'f' || unitPart === 'fahrenheit') {
            unit = 'f';
          } else if (unitPart === 'c' || unitPart === 'celsius') {
            unit = 'c';
          }
        }
      }
      
      if (isNaN(value)) {
        return txtResponse('Usage: !temp <value> [unit] (e.g., !temp 25, !temp 77 f, !temp 22c, !temp 70f)');
      }
      
      let result: string;
      
      if (unit === 'f') {
        // Fahrenheit to Celsius
        const celsius = (value - 32) * 5 / 9;
        result = `${value}°F = ${celsius.toFixed(1)}°C`;
      } else {
        // Celsius to Fahrenheit (default)
        const fahrenheit = value * 9 / 5 + 32;
        result = `${value}°C = ${fahrenheit.toFixed(1)}°F`;
      }
      
      return txtResponse(`🌡️ ${result}`);
    }

    // Moon phase command
    if (route === 'moon') {
      // Calculate moon phase locally (accurate enough for chat commands)
      const moonPhase = calculateMoonPhase();
      return txtResponse(`${moonPhase.emoji} Moon: ${moonPhase.name} (${moonPhase.illumination}% illuminated)`);
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
        } catch {
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
    // Stats route removed
    // Debug route removed

    return txtResponse('Unknown route', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return txtResponse(message, 500);
  }
}
