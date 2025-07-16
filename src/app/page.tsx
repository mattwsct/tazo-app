"use client";
import { useEffect, useRef, useState } from 'react';

// === Configurable Constants ===
const SPEED_THRESHOLD_KMH = 10;
const SPEED_HIDE_DELAY_MS = 10000;
const WEATHER_UPDATE_INTERVAL = 300000; // 5 min
const LOCATION_UPDATE_INTERVAL = 300000; // 5 min
const TIMEZONE_UPDATE_INTERVAL = 600000; // 10 min
const COORDINATE_DEBOUNCE_DEGREES = 0.001; // ~100m base
const TIMEZONE_DEBOUNCE_DEGREES = 0.1; // ~10km for timezone (less frequent)
const OVERLAY_FADE_TIMEOUT_MS = 10000; // 10 seconds to force fade-in if data not ready

// === API Keys (from .env.local, must be prefixed with NEXT_PUBLIC_) ===
const RTIRL_PULL_KEY = process.env.NEXT_PUBLIC_RTIRL_PULL_KEY;
const OPENWEATHER_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_KEY;
const LOCATIONIQ_KEY = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
const TIMEZONEDB_KEY = process.env.NEXT_PUBLIC_TIMEZONEDB_KEY;

// === Utility Functions ===
function capitalizeWords(str: string) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

const COUNTRY_SHORTENINGS: Record<string, string> = {
  'United States of America': 'USA',
  'United Kingdom': 'UK',
  'United Arab Emirates': 'UAE',
  'Antigua and Barbuda': 'Antigua',
  'Bosnia and Herzegovina': 'Bosnia',
  'Central African Republic': 'CAR',
  'Democratic Republic of the Congo': 'DR Congo',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Sao Tome and Principe': 'Sao Tome',
  'Trinidad and Tobago': 'Trinidad',
  'Turks and Caicos Islands': 'Turks & Caicos',
  'Saint Kitts and Nevis': 'St. Kitts',
  'Saint Vincent and the Grenadines': 'St. Vincent',
  'Virgin Islands, British': 'BVI',
  'Virgin Islands, U.S.': 'USVI',
  'Federated States of Micronesia': 'Micronesia',
  'Papua New Guinea': 'PNG',
  'Czech Republic': 'Czechia',
  'South Africa': 'South Africa',
  'South Korea': 'South Korea',
  'Philippines': 'Philippines',
  'New Zealand': 'New Zealand',
};

function shortenCountryName(countryName: string, countryCode = '') {
  if (!countryName) return '';
  const shortened = COUNTRY_SHORTENINGS[countryName] || countryName;
  if (shortened.length > 12 && countryCode) {
    return countryCode.toUpperCase();
  }
  return shortened;
}

function shortenLocalPart(localPart: string, fallbackLevels: string[]) {
  localPart = localPart.replace(/ \d-ch\b/, '').replace('-ku', '').replace(' City', '').trim();
  if (localPart.length > 15 && fallbackLevels.length > 0) {
    return fallbackLevels[0];
  }
  return localPart;
}

function getGeneralLocation(location: any) {
  if (!location) return '';
  const shortenedCountry = shortenCountryName(location.country || '', location.countryCode || '');
  let localPart = shortenLocalPart(location.quarter || '', [location.city_district || location.name || location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.city_district || '', [location.name || location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.name || '', [location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.city || '', [location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.state || '', []);
  if (localPart) {
    return `${localPart}, ${shortenedCountry}`;
  }
  if (location.displayName) {
    const parts = location.displayName.split(', ').map((p: string) => p.trim());
    if (parts.length >= 2) {
      let fallbackLocal = parts[parts.length - 2].replace(' City', '');
      if (/\d/.test(fallbackLocal) || fallbackLocal.length <= 3) {
        fallbackLocal = parts[parts.length - 3] || '';
      }
      if (fallbackLocal) {
        return `${fallbackLocal}, ${parts[parts.length - 1]}`;
      }
    }
  }
  return shortenedCountry;
}

function distanceMoved(lat1: number, lon1: number, lat2: number, lon2: number) {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2));
}

// === Rate Limiting ===
const RATE_LIMITS = {
  openweather: { calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 60 },
  locationiq: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 },
  timezonedb: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 1 },
};
function checkRateLimit(api: keyof typeof RATE_LIMITS) {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  if (limit.calls >= limit.max) return false;
  limit.calls++;
  return true;
}

// === API Fetch Functions ===
async function fetchWeatherFromOpenWeather(lat: number, lon: number) {
  if (!OPENWEATHER_KEY || !checkRateLimit('openweather')) return null;
  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric`);
    const data = await response.json();
    if (data.cod === 200 && data.weather && data.weather[0] && data.main) {
      return {
        temp: Math.round(data.main.temp),
        icon: data.weather[0].icon,
        desc: data.weather[0].description,
      };
    }
  } catch (err) {
    // ignore
  }
  return null;
}

async function fetchLocationFromLocationIQ(lat: number, lon: number) {
  if (!LOCATIONIQ_KEY || !checkRateLimit('locationiq')) return null;
  try {
    const response = await fetch(`https://us1.locationiq.com/v1/reverse.php?key=${LOCATIONIQ_KEY}&lat=${lat}&lon=${lon}&format=json`);
    const data = await response.json();
    if (data.address) {
      return {
        name: data.address.suburb || data.address.city_district || data.address.neighbourhood,
        quarter: data.address.quarter,
        city_district: data.address.city_district || data.address.ward || data.address.borough,
        city: data.address.city || data.address.town,
        state: data.address.state,
        country: data.address.country,
        countryCode: data.address.country_code ? data.address.country_code.toLowerCase() : '',
        timezone: data.address.timezone,
        displayName: data.display_name,
      };
    }
  } catch (err) {
    // ignore
  }
  return null;
}

async function fetchTimezoneFromTimezoneDB(lat: number, lon: number) {
  if (!TIMEZONEDB_KEY || !checkRateLimit('timezonedb')) return null;
  try {
    const response = await fetch(`https://api.timezonedb.com/v2.1/get-time-zone?key=${TIMEZONEDB_KEY}&format=json&by=position&lat=${lat}&lng=${lon}`);
    const data = await response.json();
    if (data.status === 'OK') {
      return data.zoneName;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

// === Main React Component ===
export default function Home() {
  // Overlay state
  const [showOverlay, setShowOverlay] = useState(false);
  const [time, setTime] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [speedVisible, setSpeedVisible] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [validWeather, setValidWeather] = useState(false);
  const [validLocation, setValidLocation] = useState(false);
  const [validTimezone, setValidTimezone] = useState(false);
  const [firstWeatherChecked, setFirstWeatherChecked] = useState(false);
  const [firstLocationChecked, setFirstLocationChecked] = useState(false);
  const [firstTimezoneChecked, setFirstTimezoneChecked] = useState(false);
  const [overlayForced, setOverlayForced] = useState(false);

  // Refs for timers and last coords
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastAPICoords = useRef<[number, number] | null>(null);
  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastWeatherUpdate = useRef(0);
  const lastLocationUpdate = useRef(0);
  const lastTimezoneUpdate = useRef(0);
  const currentCoords = useRef<string | null>(null);
  const weatherRefreshTimer = useRef<NodeJS.Timeout | null>(null);
  const overlayShown = useRef(false);

  // Time formatter
  const formatter = useRef<Intl.DateTimeFormat | null>(null);

  // Overlay fade-in logic
  useEffect(() => {
    if (
      !overlayShown.current &&
      firstWeatherChecked &&
      firstLocationChecked &&
      firstTimezoneChecked &&
      validWeather &&
      validLocation &&
      validTimezone
    ) {
      setShowOverlay(true);
      overlayShown.current = true;
    }
  }, [firstWeatherChecked, firstLocationChecked, firstTimezoneChecked, validWeather, validLocation, validTimezone]);

  // Force fade-in after timeout
  useEffect(() => {
    if (!overlayShown.current) {
      const timeout = setTimeout(() => {
        setShowOverlay(true);
        overlayShown.current = true;
        setOverlayForced(true);
      }, OVERLAY_FADE_TIMEOUT_MS);
      return () => clearTimeout(timeout);
    }
  }, []);

  // Time update logic
  useEffect(() => {
    if (!timezone || !formatter.current) return;
    function updateTime() {
      const now = new Date();
      setTime(formatter.current!.format(now));
    }
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [timezone]);

  // Speed display logic
  useEffect(() => {
    const kmh = speed * 3.6;
    if (kmh >= SPEED_THRESHOLD_KMH) {
      setSpeedVisible(true);
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
    } else {
      if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
      speedHideTimeout.current = setTimeout(() => {
        setSpeedVisible(false);
      }, SPEED_HIDE_DELAY_MS);
    }
    return () => {
      if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
    };
  }, [speed]);

  // Weather refresh timer
  useEffect(() => {
    if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    weatherRefreshTimer.current = setInterval(async () => {
      if (lastWeatherCoords.current) {
        const [lat, lon] = lastWeatherCoords.current;
        const w = await fetchWeatherFromOpenWeather(lat, lon);
        if (w) {
          setWeather(w);
          setValidWeather(true);
          setFirstWeatherChecked(true);
          lastWeatherUpdate.current = Date.now();
        }
      }
    }, WEATHER_UPDATE_INTERVAL);
    return () => {
      if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    };
  }, []);

  // RTIRL integration and main data update logic
  useEffect(() => {
    // Dynamically load RTIRL script
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      if (typeof window !== 'undefined' && (window as any).RealtimeIRL && RTIRL_PULL_KEY) {
        (window as any).RealtimeIRL.forPullKey(RTIRL_PULL_KEY).addListener((p: any) => {
          if (!p) return;
          // Speed
          setSpeed(typeof p.speed === 'number' ? p.speed : 0);
          // Weather
          if (p.weather?.temp && p.weather?.icon && p.weather?.desc) {
            setWeather({
              temp: Math.round(p.weather.temp),
              icon: p.weather.icon,
              desc: p.weather.desc,
            });
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
          }
          // Location
          if (p.location) {
            const loc = p.location;
            const label = getGeneralLocation(loc);
            const countryCode = loc.countryCode ? loc.countryCode.toLowerCase() : '';
            if (label && countryCode) {
              setLocation({ label, countryCode });
              setValidLocation(true);
              setFirstLocationChecked(true);
              lastLocationUpdate.current = Date.now();
            }
          }
          // Timezone
          if (p.location?.timezone && p.location.timezone !== timezone) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: p.location.timezone,
              });
              setTimezone(p.location.timezone);
              setValidTimezone(true);
              setFirstTimezoneChecked(true);
              lastTimezoneUpdate.current = Date.now();
            } catch {
              setValidTimezone(false);
              setFirstTimezoneChecked(true);
            }
          }
          // Coordinates
          let lat = null, lon = null;
          if (typeof p.location?.lat === 'number' && typeof p.location?.lon === 'number') {
            lat = p.location.lat;
            lon = p.location.lon;
          } else if (typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number') {
            lat = p.location.latitude;
            lon = p.location.longitude;
          }
          if (lat !== null && lon !== null) {
            updateFromCoordinates(lat, lon);
          }
        });
      }
    };
    return () => {
      document.body.removeChild(script);
    };
    // eslint-disable-next-line
  }, []);

  // Main data update logic
  async function updateFromCoordinates(lat: number, lon: number) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return;
    }
    const kmh = speed * 3.6;
    const debounceDegrees = kmh > 100 ? COORDINATE_DEBOUNCE_DEGREES * 10 : COORDINATE_DEBOUNCE_DEGREES;
    if (lastAPICoords.current && distanceMoved(lat, lon, lastAPICoords.current[0], lastAPICoords.current[1]) < debounceDegrees) {
      return;
    }
    lastAPICoords.current = [lat, lon];
    lastWeatherCoords.current = [lat, lon];
    const now = Date.now();
    const coordKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (
      currentCoords.current === coordKey &&
      now - lastWeatherUpdate.current < WEATHER_UPDATE_INTERVAL &&
      now - lastLocationUpdate.current < LOCATION_UPDATE_INTERVAL
    ) {
      return;
    }
    currentCoords.current = coordKey;
    if (now - lastWeatherUpdate.current > WEATHER_UPDATE_INTERVAL) {
      const w = await fetchWeatherFromOpenWeather(lat, lon);
      if (w) {
        setWeather(w);
        setValidWeather(true);
        setFirstWeatherChecked(true);
        lastWeatherUpdate.current = now;
      }
    }
    if (now - lastLocationUpdate.current > LOCATION_UPDATE_INTERVAL) {
      const loc = await fetchLocationFromLocationIQ(lat, lon);
      if (loc) {
        const label = getGeneralLocation(loc);
        setLocation({ label, countryCode: loc.countryCode || '' });
        setValidLocation(true);
        setFirstLocationChecked(true);
        lastLocationUpdate.current = now;
        if (loc.timezone && loc.timezone !== timezone) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: loc.timezone,
            });
            setTimezone(loc.timezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
            lastTimezoneUpdate.current = now;
          } catch {
            setValidTimezone(false);
            setFirstTimezoneChecked(true);
          }
        }
      }
    }
    if (now - lastTimezoneUpdate.current > TIMEZONE_UPDATE_INTERVAL || lastTimezoneUpdate.current === 0) {
      const tz = await fetchTimezoneFromTimezoneDB(lat, lon);
      if (tz && tz !== timezone) {
        try {
          formatter.current = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: tz,
          });
          setTimezone(tz);
          setValidTimezone(true);
          setFirstTimezoneChecked(true);
          lastTimezoneUpdate.current = now;
        } catch {
          setValidTimezone(false);
          setFirstTimezoneChecked(true);
        }
      }
    }
  }

  // Initial state
  useEffect(() => {
    setTime('Loading...');
    setLocation(null);
    setWeather(null);
    setSpeed(0);
    setSpeedVisible(false);
    setShowOverlay(false);
    setFirstWeatherChecked(false);
    setFirstLocationChecked(false);
    setFirstTimezoneChecked(false);
    setValidWeather(false);
    setValidLocation(false);
    setValidTimezone(false);
    setOverlayForced(false);
  }, []);

  // Render
  return (
    <div id="overlay" className={showOverlay ? 'show' : ''}>
      <div id="time" className={!validTimezone ? 'hidden' : ''}>{time}</div>
      <div id="location" className={!validLocation ? 'hidden' : ''}>
        {location && (
          <>
            <span>{location.label}</span>
            {location.countryCode && (
              <img
                className="flag"
                src={`https://flagcdn.com/${location.countryCode}.svg`}
                alt={`Country: ${location.label}`}
              />
            )}
          </>
        )}
      </div>
      <div id="weather" className={!validWeather ? 'hidden' : ''}>
        {weather && (
          <>
            <div className="temp">
              <img
                className="loaded"
                src={`https://openweathermap.org/img/wn/${weather.icon}.png`}
                alt={`Weather: ${capitalizeWords(weather.desc)}`}
                style={{ opacity: 1 }}
              />
              {weather.temp}°C / {Math.round(weather.temp * 9 / 5 + 32)}°F
            </div>
            <div className="desc">{capitalizeWords(weather.desc)}</div>
          </>
        )}
      </div>
      <div id="speed" className={speedVisible ? '' : 'hidden'}>
        {(speed * 3.6).toFixed(1)} km/h
      </div>
    </div>
  );
} 