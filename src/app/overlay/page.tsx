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
import { authenticatedFetch, createAuthenticatedEventSource } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

// === Configurable Constants ===
const SPEED_THRESHOLD_KMH = 10;
const SPEED_HIDE_DELAY_MS = 10000;
const WEATHER_TIMEZONE_UPDATE_INTERVAL = 300000; // 5 min - combined weather+timezone from same API call
const LOCATION_UPDATE_INTERVAL = 60000; // 1 min max - but also triggers on 100m movement
const LOCATION_DISTANCE_THRESHOLD = 100; // 100 meters - triggers location update when moved this far
const OVERLAY_FADE_TIMEOUT_MS = 10000; // 10 seconds to force fade-in if data not ready

// === Cost Optimization Constants ===
const DATA_REFRESH_INTERVAL = 30000; // 30 seconds - faster fallback syncing


// === API Keys (from .env.local, must be prefixed with NEXT_PUBLIC_) ===
const RTIRL_PULL_KEY = process.env.NEXT_PUBLIC_RTIRL_PULL_KEY;
const LOCATIONIQ_KEY = process.env.NEXT_PUBLIC_LOCATIONIQ_KEY;
const PULSOID_TOKEN = process.env.NEXT_PUBLIC_PULSOID_TOKEN;

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

// Pulsoid heart rate interfaces
interface PulsoidHeartRateData {
  measured_at: number;
  data: {
    heart_rate: number;
  };
}

interface HeartRateState {
  bpm: number;
  lastUpdate: number;
  isConnected: boolean;
}

// OverlaySettings interface now imported from @/types/settings

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

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// === Rate Limiting ===
const RATE_LIMITS = {
  openmeteo: { calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 600 }, // 600/min free tier
  locationiq: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 },
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



// === Open-Meteo API Functions (Free tier, no API key required!) ===

// Combined function: fetch both weather and timezone in a single API call
async function fetchWeatherAndTimezoneFromOpenMeteo(lat: number, lon: number) {
  if (!checkRateLimit('openmeteo')) {
    return null;
  }
  
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto&forecast_days=1`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    let weather = null;
    let timezone = null;
    
    // Extract weather data
    if (data.current && typeof data.current.temperature_2m === 'number' && typeof data.current.weather_code === 'number') {
      weather = {
        temp: Math.round(data.current.temperature_2m),
        icon: mapWMOToOpenWeatherIcon(data.current.weather_code),
        desc: mapWMOToDescription(data.current.weather_code),
      };
    }
    
    // Extract timezone data
    if (data.timezone) {
      timezone = data.timezone;
    }
    
    return { weather, timezone };
  } catch (error) {
    console.log('Open-Meteo combined fetch failed:', error);
  }
  return null;
}

// WMO Weather Code to OpenWeather icon mapping
function mapWMOToOpenWeatherIcon(wmoCode: number): string {
  const iconMap: Record<number, string> = {
    0: '01d',    // Clear sky
    1: '02d',    // Mainly clear
    2: '03d',    // Partly cloudy
    3: '04d',    // Overcast
    45: '50d',   // Fog
    48: '50d',   // Depositing rime fog
    51: '09d',   // Light drizzle
    53: '09d',   // Moderate drizzle
    55: '09d',   // Dense drizzle
    56: '13d',   // Light freezing drizzle
    57: '13d',   // Dense freezing drizzle
    61: '10d',   // Slight rain
    63: '10d',   // Moderate rain
    65: '10d',   // Heavy rain
    66: '13d',   // Light freezing rain
    67: '13d',   // Heavy freezing rain
    71: '13d',   // Slight snow fall
    73: '13d',   // Moderate snow fall
    75: '13d',   // Heavy snow fall
    77: '13d',   // Snow grains
    80: '09d',   // Slight rain showers
    81: '09d',   // Moderate rain showers
    82: '09d',   // Violent rain showers
    85: '13d',   // Slight snow showers
    86: '13d',   // Heavy snow showers
    95: '11d',   // Thunderstorm
    96: '11d',   // Thunderstorm with slight hail
    99: '11d',   // Thunderstorm with heavy hail
  };
  return iconMap[wmoCode] || '01d';
}

// WMO Weather Code to description mapping
function mapWMOToDescription(wmoCode: number): string {
  const descMap: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'light freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snow fall',
    73: 'moderate snow fall',
    75: 'heavy snow fall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail',
    99: 'thunderstorm with heavy hail',
  };
  return descMap[wmoCode] || 'unknown';
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

  // Heart rate state
  const [heartRate, setHeartRate] = useState<HeartRateState>({
    bpm: 0,
    lastUpdate: 0,
    isConnected: false,
  });
  const [smoothHeartRate, setSmoothHeartRate] = useState(0);
  const [stableAnimationBpm, setStableAnimationBpm] = useState(0);
  const heartRateTimeout = useRef<NodeJS.Timeout | null>(null);
  const animationUpdateTimeout = useRef<NodeJS.Timeout | null>(null);

  // Settings state
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);

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
    (settings.showSpeed && speedVisible) ||
    (heartRate.isConnected && heartRate.bpm > 0)
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

  // Weather and timezone refresh timer - every 5 minutes using latest GPS (combined API call)
  useEffect(() => {
    async function doWeatherUpdate() {
      if (lastWeatherCoords.current) {
        const [lat, lon] = lastWeatherCoords.current;
        
        // Single combined API call gets both weather and timezone data
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result) {
          // Update weather if available
          if (result.weather) {
            setWeather(result.weather);
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
          }
          
          // Update timezone if available and different
          if (result.timezone && result.timezone !== timezone) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: result.timezone,
              });
              setTimezone(result.timezone);
              setValidTimezone(true);
              setFirstTimezoneChecked(true);
              lastTimezoneUpdate.current = Date.now();
            } catch {
              setValidTimezone(false);
              setFirstTimezoneChecked(true);
            }
          }
        }
      }
    }
    
    if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    weatherRefreshTimer.current = setInterval(doWeatherUpdate, WEATHER_TIMEZONE_UPDATE_INTERVAL);
    return () => {
      if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    };
  }, [timezone]);

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

  // Smooth heart rate tempo transitions
  useEffect(() => {
    if (heartRate.bpm > 0 && heartRate.isConnected) {
      // Clear any existing timeout since we have fresh data
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
        heartRateTimeout.current = null;
      }
      
      // Smoothly transition to new BPM over 2 seconds
      const currentBpm = smoothHeartRate || heartRate.bpm;
      const targetBpm = heartRate.bpm;
      const steps = 20; // Number of transition steps
      const stepSize = (targetBpm - currentBpm) / steps;
      const stepDuration = 100; // ms per step (2 seconds total)
      
      let step = 0;
      const transitionInterval = setInterval(() => {
        step++;
        const newBpm = currentBpm + (stepSize * step);
        setSmoothHeartRate(newBpm);
        
        if (step >= steps) {
          clearInterval(transitionInterval);
          setSmoothHeartRate(targetBpm);
        }
      }, stepDuration);
      
      // Update animation BPM with a delay to prevent abrupt changes
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
      }
      
      // Only update animation speed if the change is significant (>5 BPM difference)
      const bpmDifference = Math.abs(targetBpm - stableAnimationBpm);
      if (bpmDifference > 5 || stableAnimationBpm === 0) {
        animationUpdateTimeout.current = setTimeout(() => {
          setStableAnimationBpm(targetBpm);
        }, 1000); // 1 second delay before updating animation speed
      }
      
      // Set timeout to hide heart rate if no new data after 30 seconds
      heartRateTimeout.current = setTimeout(() => {
        setHeartRate(prev => ({ ...prev, isConnected: false, bpm: 0 }));
        setSmoothHeartRate(0);
        setStableAnimationBpm(0);
      }, 30000);
      
      return () => {
        clearInterval(transitionInterval);
      };
    }
  }, [heartRate.bpm, heartRate.isConnected, smoothHeartRate, stableAnimationBpm]);

  // Pulsoid heart rate integration
  useEffect(() => {
    let pulsoidSocket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    
    function connectPulsoid() {
      if (!PULSOID_TOKEN) {
        console.log('Pulsoid token not provided, skipping heart rate integration');
        return;
      }
      
      try {
        const wsUrl = `wss://dev.pulsoid.net/api/v1/data/real_time?access_token=${PULSOID_TOKEN}`;
        pulsoidSocket = new WebSocket(wsUrl);
        
        pulsoidSocket.onopen = () => {
          console.log('Pulsoid connected');
          setHeartRate(prev => ({ ...prev, isConnected: true }));
          reconnectAttempts = 0;
        };
        
        pulsoidSocket.onmessage = (event) => {
          try {
            const data: PulsoidHeartRateData = JSON.parse(event.data);
            if (data.data && typeof data.data.heart_rate === 'number') {
              setHeartRate({
                bpm: data.data.heart_rate,
                lastUpdate: data.measured_at,
                isConnected: true,
              });
            }
          } catch (error) {
            console.log('Failed to parse Pulsoid data:', error);
          }
        };
        
        pulsoidSocket.onclose = () => {
          console.log('Pulsoid connection closed');
          setHeartRate(prev => ({ ...prev, isConnected: false }));
          
          // Auto-reconnect with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            console.log(`Reconnecting to Pulsoid in ${delay}ms (attempt ${reconnectAttempts + 1})`);
            reconnectTimeout = setTimeout(() => {
              reconnectAttempts++;
              connectPulsoid();
            }, delay);
          }
        };
        
        pulsoidSocket.onerror = (error) => {
          console.log('Pulsoid WebSocket error:', error);
        };
        
      } catch (error) {
        console.log('Failed to connect to Pulsoid:', error);
      }
    }
    
    // Start connection
    connectPulsoid();
    
    return () => {
      if (pulsoidSocket) {
        pulsoidSocket.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
      }
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
      }
    };
  }, []);

  // Main data update logic - handles location updates only on 100m+ movement (max once per minute)
  async function updateFromCoordinates(lat: number, lon: number) {
    
    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return;
    }
    
    // Store coordinates for timer-based weather/timezone updates (always)
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    // If this is the first time we're getting coordinates, do immediate weather update
    if (!hadCoords && !firstWeatherChecked) {
      try {
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result && result.weather) {
          setWeather(result.weather);
          setValidWeather(true);
          setFirstWeatherChecked(true);
          lastWeatherUpdate.current = Date.now();
        }
        
        if (result && result.timezone && result.timezone !== timezone) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: result.timezone,
            });
            setTimezone(result.timezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
            lastTimezoneUpdate.current = Date.now();
          } catch {
            setValidTimezone(false);
            setFirstTimezoneChecked(true);
          }
        }
      } catch (error) {
        console.log('Immediate weather update failed:', error);
      }
    }
    
    // Check location update: only on 100m+ movement AND respecting 1-minute rate limit
    const now = Date.now();
    let shouldUpdateLocation = false;
    
    if (lastAPICoords.current) {
      const distanceMoved = distanceInMeters(lat, lon, lastAPICoords.current[0], lastAPICoords.current[1]);
      const timeSinceLastUpdate = now - lastLocationUpdate.current;
      
      // Update only if: moved 100m+ AND at least 1 minute since last update
      shouldUpdateLocation = distanceMoved >= LOCATION_DISTANCE_THRESHOLD && timeSinceLastUpdate >= LOCATION_UPDATE_INTERVAL;
    } else {
      // First update (no rate limit needed)
      shouldUpdateLocation = true;
    }
    
    if (!shouldUpdateLocation) {
      return;
    }
    
    lastAPICoords.current = [lat, lon];
    
    const coordKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    currentCoords.current = coordKey;
    
    // Update location name from LocationIQ
    const loc = await fetchLocationFromLocationIQ(lat, lon);
    if (loc) {
      setRawLocation(loc);
      const label = formatLocation(loc);
      setLocation({ label, countryCode: loc.countryCode || '' });
      setValidLocation(true);
      setFirstLocationChecked(true);
      lastLocationUpdate.current = now;
      
      // If LocationIQ provides timezone info, use it as a fallback
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
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: browserTimezone,
            });
            setTimezone(browserTimezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
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
      loadSavedData();
    }, DATA_REFRESH_INTERVAL); // Refresh every 30 seconds for faster fallback syncing
    
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
        authenticatedFetch('/api/get-settings')
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
        authenticatedFetch('/api/get-settings')
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
      
              eventSource = createAuthenticatedEventSource('/api/settings-stream');
      
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
      {/* Stream Vitals - Heart Rate Monitor */}
      {heartRate.isConnected && heartRate.bpm > 0 && (
        <div className="stream-vitals corner-top-left">
          <div className="vitals-content">
            <div 
              className="vitals-icon beating"
              style={{
                animationDuration: stableAnimationBpm > 0 ? `${60 / stableAnimationBpm}s` : '1s'
              }}
            >
              ❤️
            </div>
            <div className="vitals-text">
              <span className="vitals-value">{Math.round(smoothHeartRate || heartRate.bpm)}</span>
              <span className="vitals-label">BPM</span>
            </div>
          </div>
        </div>
      )}

      {/* Stream Info - Live Status Display */}
      <div className="stream-info corner-top-right">
        {settings.showTime && (
          <div 
            className={`stream-time ${!validTimezone ? 'hidden' : ''}`}
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
            className={`stream-location ${!validLocation ? 'hidden' : ''}`}
          >
            {location && location.label}
          </div>
        )}
        {settings.showWeather && (
          <div 
            className={`stream-weather ${!validWeather ? 'hidden' : ''}`}
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
            className={`stream-speed ${speedVisible ? '' : 'hidden'}`}
          >
            {(speed * 3.6).toFixed(1)} km/h
          </div>
        )}
      </div>

      {/* 
        === FUTURE STREAM ELEMENTS ===
        Bottom-left: Stream Stats (followers, donations, etc.)
        Bottom-right: Chat Alerts or Recent Events
        Additional stream elements can use the unified .stream-element base class
        or specialized classes like .stream-stats, .stream-alerts, etc.
      */}
    </div>
  );
} 