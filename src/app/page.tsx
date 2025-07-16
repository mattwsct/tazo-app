"use client";

// Add global declaration at the very top
declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

// === Configurable Constants ===
const SPEED_THRESHOLD_KMH = 10;
const SPEED_HIDE_DELAY_MS = 10000;
const WEATHER_UPDATE_INTERVAL = 300000; // 5 min
const LOCATION_UPDATE_INTERVAL = 300000; // 5 min
const TIMEZONE_UPDATE_INTERVAL = 600000; // 10 min
const COORDINATE_DEBOUNCE_DEGREES = 0.001; // ~100m base
const OVERLAY_FADE_TIMEOUT_MS = 10000; // 10 seconds to force fade-in if data not ready

// === API Keys (from .env.local, must be prefixed with NEXT_PUBLIC_) ===
const RTIRL_PULL_KEY = process.env.NEXT_PUBLIC_RTIRL_PULL_KEY;
const OPENWEATHER_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_KEY;
const LOCATIONIQ_KEY = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
const TIMEZONEDB_KEY = process.env.NEXT_PUBLIC_TIMEZONEDB_KEY;

// === TypeScript Interfaces ===
interface RTIRLWeather {
  temp: number;
  icon: string;
  desc: string;
}

interface RTIRLLocation {
  country?: string;
  countryCode?: string;
  quarter?: string;
  city_district?: string;
  name?: string;
  city?: string;
  state?: string;
  displayName?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
}

interface RTIRLPayload {
  speed?: number;
  weather?: RTIRLWeather;
  location?: RTIRLLocation;
}

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

function getGeneralLocation(location: RTIRLLocation) {
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
  } catch {
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
  } catch {
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
  } catch {
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
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      if (
        typeof window !== 'undefined' &&
        window.RealtimeIRL &&
        RTIRL_PULL_KEY
      ) {
        window.RealtimeIRL.forPullKey(RTIRL_PULL_KEY).addListener((p: unknown) => {
          if (!p || typeof p !== 'object') return;
          const payload = p as RTIRLPayload;
          // Speed
          setSpeed(typeof payload.speed === 'number' ? payload.speed : 0);
          // Weather
          if (
            payload.weather &&
            typeof payload.weather === 'object' &&
            typeof payload.weather.temp === 'number' &&
            payload.weather.icon &&
            payload.weather.desc
          ) {
            setWeather({
              temp: Math.round(payload.weather.temp),
              icon: payload.weather.icon,
              desc: payload.weather.desc,
            });
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
          }
          // Location
          if (payload.location && typeof payload.location === 'object') {
            const loc = payload.location;
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
          if (
            payload.location &&
            typeof payload.location === 'object' &&
            payload.location.timezone &&
            payload.location.timezone !== timezone
          ) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: payload.location.timezone,
              });
              setTimezone(payload.location.timezone);
              setValidTimezone(true);
              setFirstTimezoneChecked(true);
              lastTimezoneUpdate.current = Date.now();
            } catch {
              setValidTimezone(false);
              setFirstTimezoneChecked(true);
            }
          }
          // Coordinates
          let lat: number | null = null;
          let lon: number | null = null;
          if (payload.location) {
            if (hasLatLon(payload.location)) {
              lat = payload.location.lat;
              lon = payload.location.lon;
            } else if (hasLatitudeLongitude(payload.location)) {
              lat = payload.location.latitude;
              lon = payload.location.longitude;
            }
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
  }, []);

  // Initial load from KV
  useEffect(() => {
    async function loadSavedLocation() {
      const res = await fetch('/api/get-location');
      if (res.ok) {
        const data = await res.json();
        if (data) {
          console.log('Loaded saved location:', data);
          setLocation(data);
          setValidLocation(true);
        }
      }
    }
    loadSavedLocation();
  }, []);

  // Type guards for coordinates
  function hasLatLon(obj: unknown): obj is { lat: number; lon: number } {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as { lat?: unknown }).lat === 'number' &&
      typeof (obj as { lon?: unknown }).lon === 'number'
    );
  }

  function hasLatitudeLongitude(obj: unknown): obj is { latitude: number; longitude: number } {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as { latitude?: unknown }).latitude === 'number' &&
      typeof (obj as { longitude?: unknown }).longitude === 'number'
    );
  }

  // Save location to API route
  useEffect(() => {
    if (location && validLocation) {
      fetch('/api/save-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location),
      }).then(() => console.log('Location saved successfully to API')).catch((err) => console.error('Failed to save location:', err));
    }
  }, [location, validLocation]);

  // Render
  return (
    <div 
      id="overlay" 
      className={`fixed top-2.5 right-2.5 text-right bg-black/30 backdrop-blur-sm rounded-xl p-4 transition-opacity duration-800 ease-out ${
        showOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div 
        id="time" 
        className={`text-4xl font-semibold my-0.5 text-white ${
          !validTimezone ? 'hidden' : ''
        }`}
      >
        {time}
      </div>
      <div 
        id="location" 
        className={`text-2xl font-semibold mt-0.5 mb-1.5 flex justify-end items-center gap-2 text-white ${
          !validLocation ? 'hidden' : ''
        }`}
      >
        {location && (
          <>
            <span>{location.label}</span>
            {location.countryCode && (
              <Image
                className="h-5 rounded ml-1"
                src={`https://flagcdn.com/${location.countryCode}.svg`}
                alt={`Country: ${location.label}`}
                width={24}
                height={16}
                unoptimized
                style={{ height: '1.25em', width: 'auto', borderRadius: 4, marginLeft: 4 }}
              />
            )}
          </>
        )}
      </div>
      <div 
        id="weather" 
        className={`flex flex-col items-end text-2xl font-semibold mt-0.5 gap-1 text-white ${
          !validWeather ? 'hidden' : ''
        }`}
      >
        {weather && (
          <>
            <div className="flex items-center gap-2.5 text-white">
              <Image
                className="h-5 drop-shadow-md opacity-100 transition-opacity duration-300 ease-in-out mr-0.5"
                src={`https://openweathermap.org/img/wn/${weather.icon}.png`}
                alt={`Weather: ${capitalizeWords(weather.desc)}`}
                width={24}
                height={24}
                unoptimized
                style={{ height: '1.25em', width: 'auto', marginRight: 2, filter: 'drop-shadow(1px 1px 2px black)' }}
              />
              {weather.temp}°C / {Math.round(weather.temp * 9 / 5 + 32)}°F
            </div>
            <div className="text-xl font-semibold text-white">
              {capitalizeWords(weather.desc)}
            </div>
          </>
        )}
      </div>
      <div 
        id="speed" 
        className={`text-xl font-semibold mt-1 text-white ${
          speedVisible ? '' : 'hidden'
        }`}
      >
        {(speed * 3.6).toFixed(1)} km/h
      </div>
    </div>
  );
} 