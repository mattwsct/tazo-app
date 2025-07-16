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
const WEATHER_UPDATE_INTERVAL = 600000; // 10 min - reduced from 5 min to save API calls
const LOCATION_UPDATE_INTERVAL = 300000; // 5 min
const TIMEZONE_UPDATE_INTERVAL = 600000; // 10 min
const COORDINATE_DEBOUNCE_DEGREES = 0.001; // ~100m base
const OVERLAY_FADE_TIMEOUT_MS = 10000; // 10 seconds to force fade-in if data not ready

// === Cost Optimization Constants ===
const DATA_REFRESH_INTERVAL = 300000; // 5 minutes - reduced from 2 minutes


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

interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
  showSpeed: boolean;
  showTime: boolean;
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





function formatLocation(location: RTIRLLocation) {
  if (!location) return '';
  
  const shortenedCountry = shortenCountryName(location.country || '', location.countryCode || '');
  
  // Try city first, but check length (16 char limit)
  if (location.city && location.city.length <= 16) {
    return `${location.city}, ${shortenedCountry}`;
  }
  
  // Fallback to state if city is too long
  if (location.state && location.state.length <= 16) {
    return `${location.state}, ${shortenedCountry}`;
  }
  
  // Final fallback: just country
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
    const response = await fetch(`https://us1.locationiq.com/v1/reverse.php?key=${LOCATIONIQ_KEY}&lat=${lat}&lon=${lon}&format=json&accept-language=en`);
    const data = await response.json();
    if (data.address) {
      // Simple parsing: just get city and country
      const city = data.address.city || 
                  data.address.town || 
                  data.address.municipality ||
                  data.address.suburb;  // Use suburb as fallback for city-level
      
      const state = data.address.province ||  // Japanese prefectures are in 'province' field
                   data.address.state || 
                   data.address.region || 
                   data.address.county;
      
      const result = {
        city: city,
        state: state,
        country: data.address.country,
        countryCode: data.address.country_code ? data.address.country_code.toLowerCase() : '',
        timezone: data.address.timezone,
        displayName: data.display_name,
      };
      
      // Debug: uncomment to see Japanese location data structure
      // if (data.address.country_code?.toLowerCase() === 'jp') {
      //   console.log('Japanese location data from LocationIQ:', {
      //     raw_address: data.address,
      //     parsed_result: result
      //   });
      // }
      
      return result;
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
  // Add overlay-page class to body for page-specific CSS
  useEffect(() => {
    document.body.classList.add('overlay-page');
    return () => {
      document.body.classList.remove('overlay-page');
    };
  }, []);

  // Overlay state
  const [showOverlay, setShowOverlay] = useState(false);
  const [time, setTime] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string } | null>(null);
  const [rawLocation, setRawLocation] = useState<RTIRLLocation | null>(null);
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

  // Settings state
  const [settings, setSettings] = useState<OverlaySettings>({
    showLocation: true,
    showWeather: true,
    showWeatherIcon: true,
    showWeatherCondition: true,
    weatherIconPosition: 'left',
    showSpeed: true,
    showTime: true,
  });

  // Refs for timers and last coords
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  const speedShowCount = useRef(0); // Count consecutive speed readings above threshold
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

  // Check if any overlay elements should be visible
  const hasVisibleElements = (
    (settings.showTime && validTimezone) ||
    (settings.showLocation && validLocation) ||
    (settings.showWeather && validWeather) ||
    (settings.showSpeed && speedVisible)
  );

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
    
    // Update immediately
    updateTime();
    
    function setupNextSync() {
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
      // Set timeout to sync with the next minute boundary
      const syncTimeout = setTimeout(() => {
        updateTime();
        
        // Set regular interval for the next hour, then re-sync
        let updateCount = 0;
        const interval = setInterval(() => {
          updateTime();
          updateCount++;
          
          // Re-sync every hour (60 updates) to prevent drift
          if (updateCount >= 60) {
            clearInterval(interval);
            setupNextSync(); // Recursively set up next sync cycle
          }
        }, 60000);
        
        // Store interval for cleanup
        return interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    
    return () => {
      clearTimeout(timeout);
      // Note: intervals are cleaned up in the recursive function
    };
  }, [timezone]);

  // Speed display logic
  useEffect(() => {
    const kmh = speed * 3.6;
    if (kmh >= SPEED_THRESHOLD_KMH) {
      // Increment counter for consecutive speed readings above threshold
      speedShowCount.current++;
      
      // Only show speed after 3 consecutive readings above threshold
      if (speedShowCount.current >= 3) {
        setSpeedVisible(true);
        if (speedHideTimeout.current) {
          clearTimeout(speedHideTimeout.current);
          speedHideTimeout.current = null;
        }
      }
    } else {
      // Reset counter when speed drops below threshold
      speedShowCount.current = 0;
      
      // Start hide timer if speed is currently visible
      if (speedVisible) {
        if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = setTimeout(() => {
          setSpeedVisible(false);
        }, SPEED_HIDE_DELAY_MS);
      }
    }
    return () => {
      if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
    };
  }, [speed, speedVisible]);

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
            const weatherData = {
              temp: Math.round(payload.weather.temp),
              icon: payload.weather.icon,
              desc: payload.weather.desc,
            };
            setWeather(weatherData);
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
            
            // Note: No longer saving weather to KV - we fetch fresh from APIs using GPS
          }
          // Location
          if (payload.location && typeof payload.location === 'object') {
            const loc = payload.location;
            setRawLocation(loc);
            const label = formatLocation(loc);
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
              
              // Note: No longer saving timezone to KV - we determine fresh from GPS coordinates
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
            // GPS is now purely real-time - no KV saving needed
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
        
        // Note: No longer saving weather to KV - we fetch fresh from APIs using GPS
      }
    }
    if (now - lastLocationUpdate.current > LOCATION_UPDATE_INTERVAL) {
      const loc = await fetchLocationFromLocationIQ(lat, lon);
      if (loc) {
        setRawLocation(loc);
        const label = formatLocation(loc);
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
            
            // Note: No longer saving timezone to KV - we determine fresh from GPS coordinates
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
          
          // Note: No longer saving timezone to KV - we determine fresh from GPS coordinates
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
    setRawLocation(null);
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

  // Initial load from KV with periodic refresh
  useEffect(() => {
    async function loadSavedData() {
      try {
        // Note: Settings are now loaded via SSE as primary method
        // This is only a fallback for timezone setup
        
        // Ensure timezone is set (fallback to browser timezone)
        if (!timezone) {
          try {
            const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            console.log('Setting browser timezone as fallback:', browserTimezone);
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: browserTimezone,
            });
            setTimezone(browserTimezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
            
            // Save browser timezone to KV for future use
            fetch('/api/save-timezone', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ timezone: browserTimezone })
            }).catch(err => console.error('Failed to save browser timezone:', err));
          } catch (error) {
            console.error('Failed to set browser timezone:', error);
            setFirstTimezoneChecked(true);
          }
        }
      } catch (error) {
        console.error('Failed to load saved data:', error);
      }
    }
    
    // Load timezone setup immediately
    loadSavedData();
    
    // Set up periodic refresh for timezone only (settings handled by SSE)
    const refreshInterval = setInterval(() => {
      console.log('Periodic timezone refresh (fallback)...');
      loadSavedData();
    }, DATA_REFRESH_INTERVAL); // Refresh every 5 minutes to reduce costs
    
         return () => {
       clearInterval(refreshInterval);
     };
   }, [timezone]); // Include timezone dependency

  // Settings real-time updates via Server-Sent Events with aggressive auto-reconnection
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
         let isPolling = false;
     let pollingInterval: NodeJS.Timeout | null = null;
    
    function startPolling() {
      if (isPolling) return;
      isPolling = true;
      console.log('Starting polling fallback for settings...');
      
      pollingInterval = setInterval(() => {
        fetch('/api/get-settings')
          .then(res => res.json())
          .then(data => {
            console.log('Polling: Settings loaded:', data);
            setSettings(data);
            
            // Try to reconnect SSE every 10 polling cycles (50 seconds)
            if (reconnectAttempts % 10 === 0) {
              console.log('Attempting to restore SSE connection...');
              stopPolling();
              reconnectAttempts = 0;
              connectSSE();
            }
          })
          .catch(err => console.error('Polling: Failed to load settings:', err));
      }, 5000); // Poll every 5 seconds
    }
    
    function stopPolling() {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      isPolling = false;
    }
    
    function connectSSE() {
      console.log('Setting up SSE connection for settings...');
      
      // Load settings immediately as fallback while SSE connects
      fetch('/api/get-settings')
        .then(res => res.json())
        .then(data => {
          console.log('Pre-SSE: Loaded initial settings:', data);
          setSettings(data);
        })
        .catch(err => console.error('Pre-SSE: Failed to load initial settings:', err));
      
      // Close existing connection
      if (eventSource) {
        eventSource.close();
      }
      
      eventSource = new EventSource('/api/settings-stream');
      
      eventSource.onopen = () => {
        console.log('SSE connection opened');
        reconnectAttempts = 0; // Reset on successful connection
        stopPolling(); // Stop polling when SSE is working
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'heartbeat') {
            console.log('[OVERLAY SSE] Heartbeat received');
            return; // Ignore heartbeat messages
          }
          
          if (data.type === 'settings_update') {
            const latency = Date.now() - (data.timestamp || 0);
            console.log(`[OVERLAY SSE] Settings update received (${latency}ms latency):`, data);
            
            // Extract just the settings (remove metadata)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { timestamp, type, ...settingsOnly } = data;
            setSettings(settingsOnly);
            console.log('[OVERLAY SSE] Settings state updated:', settingsOnly);
            return;
          }
          
          // Legacy format (without timestamp/type)
          console.log('[OVERLAY SSE] Settings update received (legacy format):', data);
          setSettings(data);
          console.log('[OVERLAY SSE] Settings state updated (legacy):', data);
        } catch (error) {
          console.error('[OVERLAY SSE] Failed to parse settings update:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('Settings stream error:', error, 'ReadyState:', eventSource?.readyState);
        
        if (eventSource?.readyState === EventSource.CLOSED || eventSource?.readyState === EventSource.CONNECTING) {
          console.log('SSE connection closed or failed to connect');
          
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), 30000); // Cap at 30s
          console.log(`Attempting to reconnect SSE in ${delay}ms (attempt ${reconnectAttempts})`);
          
          // Always try to reconnect, but start polling as backup after a few attempts
          if (reconnectAttempts >= 3 && !isPolling) {
            startPolling();
          }
          
          reconnectTimeout = setTimeout(() => {
            connectSSE();
          }, delay);
        }
      };
    }
    
    // Initial connection
    connectSSE();
    
    return () => {
      console.log('Cleaning up SSE connection and polling');
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      stopPolling();
    };
  }, []);

  // Reformat location when raw location changes
  useEffect(() => {
    if (rawLocation) {
      const label = formatLocation(rawLocation);
      const countryCode = rawLocation.countryCode ? rawLocation.countryCode.toLowerCase() : '';
      if (label && countryCode) {
        setLocation({ label, countryCode });
      }
    }
  }, [rawLocation]);

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

  // Note: No longer saving location to KV - we fetch fresh from APIs using GPS coordinates

  // Render
  return (
    <div 
      id="overlay" 
      className={showOverlay && hasVisibleElements ? 'show' : ''}
    >
      {/* Main info card in top-right corner */}
      <div className="main-info corner-top-right">
        {settings.showTime && (
          <div 
            id="time" 
            className={ !validTimezone ? 'hidden' : '' }
          >
            <span>{time}</span>
            {location && location.countryCode && settings.showLocation && (
              <Image
                src={`https://flagcdn.com/${location.countryCode}.svg`}
                alt={`Country: ${location.label}`}
                width={32}
                height={20}
                unoptimized
              />
            )}
          </div>
        )}
        {settings.showLocation && (
          <div 
            id="location" 
            className={ !validLocation ? 'hidden' : '' }
          >
            {location && location.label}
          </div>
        )}
        {settings.showWeather && (
          <div 
            id="weather" 
            className={ !validWeather ? 'hidden' : '' }
          >
            {weather && (
              <>
                <div className="weather-temp" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexDirection: settings.weatherIconPosition === 'left' ? 'row-reverse' : 'row'
                }}>
                  <span>{weather.temp}°C / {Math.round(weather.temp * 9 / 5 + 32)}°F</span>
                  {settings.showWeatherIcon && (
                    <div className="weather-icon-container">
                      <Image
                        src={`https://openweathermap.org/img/wn/${weather.icon}@4x.png`}
                        alt={`Weather: ${capitalizeWords(weather.desc)}`}
                        width={30}
                        height={30}
                        unoptimized
                      />
                    </div>
                  )}
                </div>
                {settings.showWeatherCondition && (
                  <div className="weather-desc">
                    {capitalizeWords(weather.desc)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {settings.showSpeed && (
          <div 
            id="speed" 
            className={ speedVisible ? '' : 'hidden' }
          >
            {(speed * 3.6).toFixed(1)} km/h
          </div>
        )}
      </div>

      {/* Future corner elements will go here */}
      {/* Bottom-left: Kick.com subgoal */}
      {/* Top-right: Pulsoid heartrate (separate from main info) */}
    </div>
  );
} 