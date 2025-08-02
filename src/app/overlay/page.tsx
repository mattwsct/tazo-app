"use client";

declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import HeartRateMonitor from '@/components/HeartRateMonitor';
import KickSubGoal from '@/components/KickSubGoal';

import { 
  fetchWeatherAndTimezoneFromOpenMeteo,
  fetchLocationFromLocationIQ,
  WeatherTimezoneResponse,
} from '@/utils/api-utils';
import {
  formatLocation,
  distanceInMeters,
  isValidCoordinate,
  celsiusToFahrenheit,
  LocationData,
} from '@/utils/overlay-utils';
import { OverlayLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';

const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});

// Move static objects outside component to prevent recreation on every render
const WMO_TO_OPENWEATHER: Record<string, string> = {
  '0': '01',    // Clear sky
  '1': '02',    // Mainly clear
  '2': '03',    // Partly cloudy
  '3': '04',    // Overcast
  '45': '50',   // Fog
  '48': '50',   // Depositing rime fog
  '51': '09',   // Light drizzle
  '53': '09',   // Moderate drizzle
  '55': '09',   // Dense drizzle
  '56': '13',   // Light freezing drizzle
  '57': '13',   // Dense freezing drizzle
  '61': '10',   // Slight rain
  '63': '10',   // Moderate rain
  '65': '10',   // Heavy rain
  '66': '13',   // Light freezing rain
  '67': '13',   // Heavy freezing rain
  '71': '13',   // Slight snow fall
  '73': '13',   // Moderate snow fall
  '75': '13',   // Heavy snow fall
  '77': '13',   // Snow grains
  '80': '09',   // Slight rain showers
  '81': '09',   // Moderate rain showers
  '82': '09',   // Violent rain showers
  '85': '13',   // Slight snow showers
  '86': '13',   // Heavy snow showers
  '95': '11',   // Thunderstorm
  '96': '11',   // Thunderstorm with slight hail
  '99': '11',   // Thunderstorm with heavy hail
} as const;

const WEATHER_FALLBACK_MAP: Record<string, string> = {
  '0': '☀️', '1': '🌤️', '2': '⛅', '3': '☁️',
  '45': '🌫️', '48': '🌫️', '51': '🌦️', '53': '🌦️', '55': '🌧️',
  '56': '🌨️', '57': '🌨️', '61': '🌧️', '63': '🌧️', '65': '🌧️',
  '66': '🌨️', '67': '🌨️', '71': '🌨️', '73': '🌨️', '75': '🌨️',
  '77': '🌨️', '80': '🌦️', '81': '🌧️', '82': '🌧️', '85': '🌨️',
  '86': '🌨️', '95': '⛈️', '96': '⛈️', '99': '⛈️'
} as const;

function getWeatherIcon(wmoCode: string, timezone: string | null, sunrise: string | null, sunset: string | null): string {
  const baseIcon = WMO_TO_OPENWEATHER[wmoCode] || '01';
  
  // Determine if it's day or night
  if (!timezone) return baseIcon + 'd';

  try {
    // Get current time in the location's timezone for accurate day/night detection
    const now = new Date();
    const currentLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    let isDay = true;

    if (sunrise && sunset) {
      const sunriseTime = new Date(sunrise);
      const sunsetTime = new Date(sunset);
      isDay = currentLocal >= sunriseTime && currentLocal < sunsetTime;
    } else {
      const hour = currentLocal.getHours();
      isDay = hour >= 6 && hour < 18;
    }

    return baseIcon + (isDay ? 'd' : 'n');
  } catch {
    return baseIcon + 'd';
  }
}

// Temperature zones and color mapping - Research-based comfort zones
const TEMPERATURE_ZONES = {
  VERY_COLD: { min: -50, max: 9, color: '#1E3A8A', name: 'Very Cold' },      // Dark blue
  COLD: { min: 10, max: 17, color: '#4A90E2', name: 'Cold' },                // Blue
  COMFORTABLE: { min: 18, max: 23, color: '#FFFFFF', name: 'Comfortable' },  // White
  WARM: { min: 24, max: 27, color: '#FFB3B3', name: 'Warm' },                // Light red
  HOT: { min: 28, max: 34, color: '#FF6B6B', name: 'Hot' },                  // Red
  VERY_HOT: { min: 35, max: 50, color: '#DC2626', name: 'Very Hot' },        // Dark red
} as const;

// Function to get temperature zone and color
function getTemperatureZone(temp: number) {
  return Object.values(TEMPERATURE_ZONES).find(zone => temp >= zone.min && temp <= zone.max) || TEMPERATURE_ZONES.VERY_HOT;
}

function getWeatherFallback(wmoCode: string): string {
  return WEATHER_FALLBACK_MAP[wmoCode] || '🌤️';
}

const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes (unchanged - Open-Meteo is generous: 600/min)
  LOCATION_UPDATE: 60000, // 60s - LocationIQ is very strict (2/sec, so we're conservative)
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 10000, // 10s - consistent with speed indicator
  SPEED_HIDE_DELAY: 10000, // 10s - consistent with minimap
  SPEED_DATA_TIMEOUT: 10000, // 10s - hide minimap if no speed data for 10 seconds
  API_COOLDOWN: 60000, // 60s - more conservative for LocationIQ rate limits (2/sec)
  FIRST_LOAD_API_COOLDOWN: 10000, // 10s for first load - more conservative for rate limits
} as const;

const THRESHOLDS = {
  LOCATION_DISTANCE: 100, // 100m - conservative to avoid excessive API calls
  SPEED_SHOW: 10, // 10 km/h - show for faster transport
  SPEED_READINGS_REQUIRED: 2,
  // Adaptive thresholds based on speed
  HIGH_SPEED_THRESHOLD: 50, // km/h - above this, use adaptive distance
  BULLET_TRAIN_SPEED: 200, // km/h - above this, very conservative updates
} as const;

const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

interface RTIRLPayload {
  speed?: number;
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
}

export default function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // Filter out RTIRL Firebase cookie warnings to clean up console
  useEffect(() => {
    const originalWarn = console.warn;
    const filteredWarn = (...args: Parameters<typeof console.warn>) => {
      const message = args[0];
      if (typeof message === 'string' && message.includes('Cookie "" has been rejected as third-party')) {
        return; // Suppress RTIRL cookie warnings
      }
      originalWarn.apply(console, args);
    };
    
    console.warn = filteredWarn;

    return () => {
      console.warn = originalWarn;
    };
  }, []);

  const [time, setTime] = useState('Loading...');
  const [date, setDate] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string; originalData?: LocationData } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [speedIndicatorVisible, setSpeedIndicatorVisible] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sunrise, setSunrise] = useState<string | null>(null);
  const [sunset, setSunset] = useState<string | null>(null);
  const [minimapOpacity, setMinimapOpacity] = useState(1);
  const [isLoading, setIsLoading] = useState({
    weather: true,
    location: true,
    timezone: true
  });
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [subGoalData, setSubGoalData] = useState<{
    currentSubs?: number;
    latestSub?: string | null;
    lastUpdate?: number;
  } | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);


  const lastAPICoords = useRef<[number, number] | null>(null);
  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastLocationUpdate = useRef(0);
  const minimapTimeout = useRef<NodeJS.Timeout | null>(null);
  // Minimap state management
  const minimapState = useRef({
    speedBasedVisible: false,
    speedAboveThresholdCount: 0,
    lastSpeedUpdate: 0,
    currentMode: 'hidden' as 'hidden' | 'manual' | 'speed-based'
  });
  
  // Speed indicator state management
  const speedIndicatorState = useRef({
    visible: false,
    aboveThresholdCount: 0,
    lastSpeedUpdate: 0
  });
  
  // Timeout management
  const timeouts = useRef({
    speedHide: null as NodeJS.Timeout | null,
    speedData: null as NodeJS.Timeout | null,
    speedIndicatorHide: null as NodeJS.Timeout | null,
    minimap: null as NodeJS.Timeout | null
  });
  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);
  const isFirstLoad = useRef(true); // Track if this is the first load
  const timeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const safeSettings = useMemo(() => ({ ...DEFAULT_OVERLAY_SETTINGS, ...settings }), [settings]);

  // Helper functions for minimap state management
  const clearAllTimeouts = useCallback(() => {
    Object.values(timeouts.current).forEach(timeout => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
    timeouts.current = {
      speedHide: null,
      speedData: null,
      speedIndicatorHide: null,
      minimap: null
    };
  }, []);

  // Optimized timeout cleanup for specific timeout types
  const clearTimeoutByType = useCallback((type: keyof typeof timeouts.current) => {
    if (timeouts.current[type]) {
      clearTimeout(timeouts.current[type]!);
      timeouts.current[type] = null;
    }
  }, []);

  const resetMinimapState = useCallback((mode: 'hidden' | 'manual' | 'speed-based') => {
    minimapState.current = {
      speedBasedVisible: false,
      speedAboveThresholdCount: 0,
      lastSpeedUpdate: minimapState.current.lastSpeedUpdate,
      currentMode: mode
    };
    clearAllTimeouts();
    
    OverlayLogger.overlay(`Minimap state reset to mode: ${mode}`, {
      previousMode: minimapState.current.currentMode,
      newMode: mode
    });
  }, [clearAllTimeouts]);

  const updateSpeedData = useCallback((newSpeed: number) => {
    const now = Date.now();
    minimapState.current.lastSpeedUpdate = now;
    
    // Clear any existing speed data timeout
    if (timeouts.current.speedData) {
      clearTimeout(timeouts.current.speedData);
      timeouts.current.speedData = null;
    }
    
    OverlayLogger.overlay('Speed data updated', {
      speed: newSpeed,
      timestamp: now
    });
  }, []);

  const checkSpeedDataStale = useCallback(() => {
    const timeSinceLastUpdate = Date.now() - minimapState.current.lastSpeedUpdate;
    const isStale = timeSinceLastUpdate > TIMERS.SPEED_DATA_TIMEOUT;
    
    if (isStale) {
      OverlayLogger.overlay('Speed data is stale', {
        timeSinceLastUpdate,
        timeout: TIMERS.SPEED_DATA_TIMEOUT,
        isStale
      });
    }
    
    return { isStale, timeSinceLastUpdate };
  }, []);

  // Shared speed utilities
  const getSpeedKmh = useCallback((speedMs: number) => speedMs * 3.6, []);
  const isAboveSpeedThreshold = useCallback((speedKmh: number, threshold: number = 10) => speedKmh >= threshold, []);

  // Shared logging function for speed visibility changes
  const logSpeedVisibility = useCallback((action: 'shown' | 'hidden', element: 'Minimap' | 'Speed indicator', kmh: number) => {
    const reason = action === 'shown' ? 'speed threshold' : 'speed drop';
    OverlayLogger.overlay(`${element} ${action} due to ${reason}`, { 
      speed: kmh, 
      threshold: THRESHOLDS.SPEED_SHOW 
    });
  }, []);

  // Speed indicator helper functions
  const resetSpeedIndicatorState = useCallback(() => {
    speedIndicatorState.current = {
      visible: false,
      aboveThresholdCount: 0,
      lastSpeedUpdate: speedIndicatorState.current.lastSpeedUpdate
    };
    
    if (timeouts.current.speedIndicatorHide) {
      clearTimeout(timeouts.current.speedIndicatorHide);
      timeouts.current.speedIndicatorHide = null;
    }
    
    OverlayLogger.overlay('Speed indicator state reset', {
      previousVisible: speedIndicatorState.current.visible,
      newVisible: false
    });
  }, []);

  const updateSpeedIndicatorData = useCallback((newSpeed: number) => {
    const now = Date.now();
    speedIndicatorState.current.lastSpeedUpdate = now;
    
    OverlayLogger.overlay('Speed indicator data updated', {
      speed: newSpeed,
      timestamp: now
    });
  }, []);

  // Memoized speed values to prevent unnecessary recalculations
  const speedKmh = useMemo(() => getSpeedKmh(speed), [speed, getSpeedKmh]);
  const speedRounded = useMemo(() => Math.round(speedKmh), [speedKmh]);

  // Calculate adaptive distance threshold based on speed
  const getAdaptiveDistanceThreshold = useCallback((speedKmh: number): number => {
    if (speedKmh >= THRESHOLDS.BULLET_TRAIN_SPEED) {
      // Bullet train speeds (200+ km/h): very conservative
      return 5000; // 5km - only update every 5km
    } else if (speedKmh >= THRESHOLDS.HIGH_SPEED_THRESHOLD) {
      // High speeds (50+ km/h): moderate conservative
      return Math.max(500, speedKmh * 10); // At least 500m, scales with speed
    } else {
      // Normal speeds: standard threshold
      return THRESHOLDS.LOCATION_DISTANCE;
    }
  }, []);

  const createDateTimeFormatters = useCallback((timezone: string) => {
    formatter.current = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    dateFormatter.current = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    });
  }, []);

  const setLoadingState = useCallback((type: 'weather' | 'timezone' | 'location', loading: boolean) => {
    setIsLoading(prev => ({ ...prev, [type]: loading }));
  }, []);

  const processWeatherResult = useCallback(async (result: WeatherTimezoneResponse | null, isInitial = false) => {
    if (!result) {
      OverlayLogger.warn('Weather API failed');
      setWeather(null);
      setLoadingState('weather', false);
      return;
    }

    if (result.weather) {
      setWeather(result.weather);
      setLoadingState('weather', false);
      OverlayLogger.weather(isInitial ? 'Initial weather data loaded' : 'Weather data updated successfully', result.weather);
    } else {
      setLoadingState('weather', false);
    }
    
    if (result.sunrise && result.sunset) {
      setSunrise(result.sunrise);
      setSunset(result.sunset);
    }
    
    if (result.timezone && result.timezone !== timezone) {
      try {
        createDateTimeFormatters(result.timezone);
        setTimezone(result.timezone);
        setLoadingState('timezone', false);
        OverlayLogger.overlay(isInitial ? 'Initial timezone set' : 'Timezone updated successfully', { timezone: result.timezone });
      } catch (error) {
        OverlayLogger.error(isInitial ? 'Failed to set initial timezone' : 'Failed to set timezone', error);
        setLoadingState('timezone', false);
      }
    }
  }, [timezone, createDateTimeFormatters, setLoadingState]);

  const updateFromCoordinates = useCallback(async (lat: number, lon: number) => {
    if (!isValidCoordinate(lat, lon)) {
      OverlayLogger.error('Invalid coordinates received', { lat, lon });
      return;
    }
    
    // Ensure we have valid coordinates before making any API calls
    if (lat === 0 && lon === 0) {
      OverlayLogger.warn('Received zero coordinates, skipping API calls');
      return;
    }
    
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    // On first load, always fetch fresh data regardless of cooldowns
    const isFirstLoadNow = isFirstLoad.current;
    if (isFirstLoadNow) {
      isFirstLoad.current = false;
      OverlayLogger.overlay('First load detected - fetching fresh API data immediately', { lat, lon });
    }
    
    // Fetch weather data (if we don't have it or it's first load)
    if (!hadCoords || isFirstLoadNow) {
      const currentTime = Date.now();
      const cooldown = isFirstLoadNow ? TIMERS.FIRST_LOAD_API_COOLDOWN : TIMERS.API_COOLDOWN;
      
      if ((currentTime - lastWeatherAPICall.current) >= cooldown) {
        lastWeatherAPICall.current = currentTime;
        try {
          OverlayLogger.overlay('Fetching weather data from API', { lat, lon });
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result, isFirstLoadNow);
        } catch (error) {
          OverlayLogger.error('Weather update failed', error);
          setWeather(null);
          setLoadingState('weather', false);
        }
      } else {
        const remainingCooldown = cooldown - (currentTime - lastWeatherAPICall.current);
        OverlayLogger.overlay('Weather API call skipped due to cooldown', { remainingMs: remainingCooldown });
        setLoadingState('weather', false);
      }
    }
    
    // Fetch location name data (if we don't have it or it's first load or moved enough)
    const now = Date.now();
    
    // Calculate adaptive distance threshold based on current speed
    const speedKmh = speed * 3.6; // Convert m/s to km/h
    const adaptiveDistanceThreshold = getAdaptiveDistanceThreshold(speedKmh);
    
    const shouldUpdateLocation = isFirstLoadNow || !lastAPICoords.current || (
      distanceInMeters(lat, lon, lastAPICoords.current![0], lastAPICoords.current![1]) >= adaptiveDistanceThreshold &&
      (now - lastLocationUpdate.current) >= TIMERS.LOCATION_UPDATE
    );
    
    if (!shouldUpdateLocation) {
      if (lastAPICoords.current) {
        const distance = distanceInMeters(lat, lon, lastAPICoords.current[0], lastAPICoords.current[1]);
        const timeSinceUpdate = now - lastLocationUpdate.current;
        OverlayLogger.overlay('Location update skipped', { 
          distance, 
          adaptiveThreshold: adaptiveDistanceThreshold,
          speedKmh,
          timeSinceUpdate,
          timeThreshold: TIMERS.LOCATION_UPDATE
        });
      } else {
        OverlayLogger.overlay('Location update skipped - no previous coordinates');
      }
      return;
    }
    
    lastAPICoords.current = [lat, lon];
    
    if (API_KEYS.LOCATIONIQ) {
      const cooldown = isFirstLoadNow ? TIMERS.FIRST_LOAD_API_COOLDOWN : TIMERS.API_COOLDOWN;
      
      if ((now - lastLocationAPICall.current) >= cooldown) {
        lastLocationAPICall.current = now;
        try {
          OverlayLogger.overlay('Fetching location name from API', { lat, lon });
          const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
          if (loc) {
            const label = formatLocation(loc, settings.locationDisplay);
            setLocation({ label, countryCode: loc.countryCode || '', originalData: loc });
            setLoadingState('location', false);
            lastLocationUpdate.current = now;
            
            // Only update timezone from LocationIQ if RTIRL didn't provide one
            if (loc.timezone && !currentTimezone.current && loc.timezone !== currentTimezone.current) {
              try {
                createDateTimeFormatters(loc.timezone);
                setTimezone(loc.timezone);
                setLoadingState('timezone', false);
                OverlayLogger.overlay('Timezone updated from LocationIQ (fallback)', { timezone: loc.timezone });
              } catch (error) {
                OverlayLogger.error('Failed to set timezone from LocationIQ', error);
                setLoadingState('timezone', false);
              }
            }
          } else {
            setLoadingState('location', false);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          OverlayLogger.error(`Location API failed: ${errorMessage}`);
          setLoadingState('location', false);
        }
      } else {
        const remainingCooldown = cooldown - (now - lastLocationAPICall.current);
        OverlayLogger.overlay('Location API call skipped due to cooldown', { remainingMs: remainingCooldown });
        // Don't set loading to false here - keep it loading until we get data
      }
    } else {
      OverlayLogger.warn('LocationIQ API key not available');
      setLoadingState('location', false);
    }
  }, [settings.locationDisplay, processWeatherResult, setLoadingState, createDateTimeFormatters, getAdaptiveDistanceThreshold, speed]);

  const shouldShowMinimap = useCallback(() => {
    // If location is hidden, never show minimap
    if (settings.locationDisplay === 'hidden') {
      return false;
    }
    
    // If speed-based mode is enabled, show only when moving
    if (settings.minimapSpeedBased) {
      return minimapState.current.speedBasedVisible && mapCoords;
    }
    
    // If manual mode is enabled, show when we have coordinates
    if (settings.showMinimap) {
      return mapCoords !== null;
    }
    
    // Default: don't show
    return false;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay]);

  const isLocationEnabled = settings.locationDisplay && settings.locationDisplay !== 'hidden';
  const isOverlayReady = useMemo(() => !isLoading.timezone, [isLoading.timezone]);

  // Memoize weather icon to prevent unnecessary recalculations
  const weatherIcon = useMemo(() => {
    if (!weather?.icon || !timezone) return null;
    return getWeatherIcon(weather.icon, timezone, sunrise, sunset);
  }, [weather?.icon, timezone, sunrise, sunset]);

  useEffect(() => {
    const eventSource = new EventSource('/api/settings-stream');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'settings_update') {
          if (data._subGoalData) {
            setSubGoalData(data._subGoalData);
          }
          
          // Only update settings if they've actually changed
          const hasMinimapChanges = data.showMinimap !== settings.showMinimap || 
                                   data.minimapSpeedBased !== settings.minimapSpeedBased ||
                                   data.locationDisplay !== settings.locationDisplay;
          
          if (hasMinimapChanges) {
            OverlayLogger.settings(`Minimap settings updated: showMinimap=${data.showMinimap}, speedBased=${data.minimapSpeedBased}, locationDisplay=${data.locationDisplay}`);
          }
          
          setSettings(data);
        }
      } catch (error) {
        OverlayLogger.error('Failed to parse SSE message:', error);
      }
    };
    
    eventSource.onerror = () => {
      setTimeout(() => eventSource.close(), 5000);
    };
    
    return () => {
      eventSource.close();
    };
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay]);

  useEffect(() => {
    currentSettings.current = settings;
  }, [settings]);

  useEffect(() => {
    currentIsLoading.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    currentTimezone.current = timezone;
  }, [timezone]);

  useEffect(() => {
    // Reset minimap state when settings change
    if (settings.locationDisplay === 'hidden') {
      // Location is hidden: force hide minimap and reset all speed state
      resetMinimapState('hidden');
      setMinimapOpacity(0);
    } else if (settings.minimapSpeedBased) {
      // Speed-based mode: start hidden
      resetMinimapState('speed-based');
      setMinimapOpacity(0);
    } else if (settings.showMinimap) {
      // Manual mode: start visible if we have coordinates
      resetMinimapState('manual');
      setMinimapOpacity(1);
    } else {
      // Hidden mode: ensure hidden
      resetMinimapState('hidden');
      setMinimapOpacity(0);
    }
  }, [settings.minimapSpeedBased, settings.showMinimap, settings.locationDisplay, resetMinimapState]);

  useEffect(() => {
    const hasRequiredSettings = settings.locationDisplay !== undefined && 
                               settings.showWeather !== undefined && 
                               settings.showMinimap !== undefined;
    
    if (!hasRequiredSettings) {
      setSettings(DEFAULT_OVERLAY_SETTINGS);
    }
  }, [settings]);

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      const delay = setTimeout(() => setOverlayVisible(true), 200);
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);

  useEffect(() => {
    if (!timezone || !formatter.current || !dateFormatter.current) return;
    
    function updateTimeAndDate() {
      const now = new Date();
      const timeParts = formatter.current!.formatToParts(now);
      const timePart = timeParts.find(part => part.type === 'hour' || part.type === 'minute')?.value || '';
      const minutePart = timeParts.find(part => part.type === 'minute')?.value || '';
      const ampmPart = timeParts.find(part => part.type === 'dayPeriod')?.value || '';
      
      setTime(`${timePart}:${minutePart} ${ampmPart}`);
      setDate(dateFormatter.current!.format(now));
    }
    
    updateTimeAndDate();
    
    function setupNextSync() {
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
      const syncTimeout = setTimeout(() => {
        updateTimeAndDate();
        
        let updateCount = 0;
        const interval = setInterval(() => {
          updateTimeAndDate();
          updateCount++;
          
          if (updateCount >= 60) {
            clearInterval(interval);
            setupNextSync();
          }
        }, 60000);
        
        // Store interval reference for cleanup
        timeIntervalRef.current = interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    return () => {
      clearTimeout(timeout);
      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current);
        timeIntervalRef.current = null;
      }
    };
  }, [timezone]);

  useEffect(() => {
    if (!lastWeatherCoords.current) return;
    
    const interval = setInterval(async () => {
      const now = Date.now();
      if ((now - lastWeatherAPICall.current) >= TIMERS.WEATHER_TIMEZONE_UPDATE) {
        lastWeatherAPICall.current = now;
        const [lat, lon] = lastWeatherCoords.current!;
        
        try {
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          OverlayLogger.error(`Weather update failed: ${errorMessage}`);
          setWeather(null);
          setLoadingState('weather', false);
        }
      }
    }, TIMERS.WEATHER_TIMEZONE_UPDATE);
    
    return () => clearInterval(interval);
  }, [processWeatherResult, setLoadingState]);

  useEffect(() => {
    // Load RTIRL script immediately without delay
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
    script.async = true;
    script.onerror = () => {
      OverlayLogger.error('Failed to load RTIRL script');
    };
    document.body.appendChild(script);
    
    script.onload = () => {
      OverlayLogger.overlay('RTIRL script loaded, initializing connection...');
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        OverlayLogger.overlay('RTIRL API available, setting up listener...');
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          if (!p || typeof p !== 'object') return;
          const payload = p as RTIRLPayload;
          
          // Handle speed data immediately
          if (typeof payload.speed === 'number') {
            setSpeed(payload.speed);
            updateSpeedData(payload.speed);
            updateSpeedIndicatorData(payload.speed);
          }
          
          // Handle timezone from RTIRL FIRST (before API calls)
          if (payload.location?.timezone && payload.location.timezone !== currentTimezone.current) {
            try {
              createDateTimeFormatters(payload.location.timezone);
              setTimezone(payload.location.timezone);
              setLoadingState('timezone', false);
              OverlayLogger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
            } catch (error) {
              OverlayLogger.error('Failed to set timezone from RTIRL', error);
              setLoadingState('timezone', false);
            }
          }
          
          // Extract GPS coordinates
          let lat: number | null = null;
          let lon: number | null = null;
          if (payload.location) {
            if ('lat' in payload.location && 'lon' in payload.location) {
              lat = payload.location.lat;
              lon = payload.location.lon;
            } else if ('latitude' in payload.location && 'longitude' in payload.location) {
              const loc = payload.location as { latitude: number; longitude: number };
              lat = loc.latitude;
              lon = loc.longitude;
            }
          }
          
          if (lat !== null && lon !== null && isValidCoordinate(lat, lon)) {
            OverlayLogger.overlay('RTIRL GPS data received', { lat, lon, isFirstLoad: isFirstLoad.current });
            
            // Update map coordinates immediately
            setMapCoords([lat, lon]);
            
            // Handle minimap timeout
            if (minimapTimeout.current) {
              clearTimeout(minimapTimeout.current);
            }
            if (!currentSettings.current.showMinimap) {
              minimapTimeout.current = setTimeout(() => {
                setMapCoords(null);
              }, TIMERS.MINIMAP_HIDE_DELAY);
            }
            
            // Now fetch additional data (location name, weather) from APIs
            updateFromCoordinates(lat, lon);
          } else {
            OverlayLogger.warn('RTIRL GPS data invalid');
          }
        });
      } else {
        if (!API_KEYS.RTIRL) {
          OverlayLogger.warn('RTIRL API key not available');
        } else {
          OverlayLogger.warn('RealtimeIRL API not available');
        }
      }
    };
    
    // Cleanup function
    return () => {
      // RTIRL script cleanup handled automatically
    };
  }, [updateFromCoordinates, createDateTimeFormatters, setLoadingState, updateSpeedData, updateSpeedIndicatorData]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/get-settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        if (data) {
          setSettings(data);
          if (data._subGoalData) {
            setSubGoalData(data._subGoalData);
          }
        } else {
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        }
      } catch (error) {
        OverlayLogger.error('Failed to load settings, using defaults:', error);
        setSettings(DEFAULT_OVERLAY_SETTINGS);
      }
    };
    
    loadSettings();
  }, []);

  useEffect(() => {
    // Clear any existing timeout when settings change
    if (minimapTimeout.current) {
      clearTimeout(minimapTimeout.current);
      minimapTimeout.current = null;
    }
    
    // If minimap should be hidden and we have coordinates, set a timeout to clear them
    if (!shouldShowMinimap() && mapCoords) {
      minimapTimeout.current = setTimeout(() => {
        setMapCoords(null);
      }, TIMERS.MINIMAP_HIDE_DELAY);
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, mapCoords, shouldShowMinimap]);

  useEffect(() => {
    // Reset speed-based state when mode changes or location is disabled
    if (!settings.minimapSpeedBased || settings.locationDisplay === 'hidden') {
      resetMinimapState('hidden');
      setMinimapOpacity(0);
      return;
    }

    // Only process speed-based logic if speed-based mode is enabled AND location is enabled
    if (settings.minimapSpeedBased && settings.locationDisplay && (settings.locationDisplay === 'city' || settings.locationDisplay === 'state')) {
      const kmh = getSpeedKmh(speed);
      const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);

      if (isAboveThreshold) {
        minimapState.current.speedAboveThresholdCount++;
        
        // Show minimap when speed threshold is met (requires 2 readings to prevent false positives)
        if (minimapState.current.speedAboveThresholdCount >= 2) {
          clearTimeoutByType('speedHide');
          
          if (!minimapState.current.speedBasedVisible) {
            minimapState.current.speedBasedVisible = true;
            setMinimapOpacity(1);
            logSpeedVisibility('shown', 'Minimap', kmh);
          }
        }
      } else {
        minimapState.current.speedAboveThresholdCount = 0;
        
        // Hide minimap after brief delay when speed drops below threshold
        if (minimapState.current.speedBasedVisible && !timeouts.current.speedHide) {
          timeouts.current.speedHide = setTimeout(() => {
            minimapState.current.speedBasedVisible = false;
            setMinimapOpacity(0);
            timeouts.current.speedHide = null;
            logSpeedVisibility('hidden', 'Minimap', kmh);
          }, TIMERS.SPEED_HIDE_DELAY);
        }
      }
    }
  }, [speed, settings.minimapSpeedBased, settings.locationDisplay, resetMinimapState, clearTimeoutByType, getSpeedKmh, isAboveSpeedThreshold, logSpeedVisibility]);

  // Speed data timeout effect - hide minimap if no speed data for too long
  useEffect(() => {
    // Only apply timeout logic if speed-based mode is enabled and location is enabled
    if (!settings.minimapSpeedBased || settings.locationDisplay === 'hidden') {
      // Clear any existing timeout
      if (timeouts.current.speedData) {
        clearTimeout(timeouts.current.speedData);
        timeouts.current.speedData = null;
      }
      return;
    }

    // Check if speed data is stale using helper function
    const { isStale, timeSinceLastUpdate } = checkSpeedDataStale();

    if (isStale && minimapState.current.speedBasedVisible) {
      // Speed data is stale and minimap is visible - hide it
      OverlayLogger.overlay('Speed data timeout - hiding minimap due to stale data', { 
        timeSinceLastUpdate,
        timeout: TIMERS.SPEED_DATA_TIMEOUT 
      });
      
      minimapState.current.speedBasedVisible = false;
      minimapState.current.speedAboveThresholdCount = 0;
      setMinimapOpacity(0);
      
      // Clear any existing hide timeout
      if (timeouts.current.speedHide) {
        clearTimeout(timeouts.current.speedHide);
        timeouts.current.speedHide = null;
      }
    } else if (!isStale && minimapState.current.speedBasedVisible) {
      // Speed data is fresh and minimap is visible - set up timeout for next check
      if (timeouts.current.speedData) {
        clearTimeout(timeouts.current.speedData);
      }
      
      timeouts.current.speedData = setTimeout(() => {
        // This will trigger the effect again to check if data is stale
        setSpeed(prev => prev); // Force re-evaluation
      }, TIMERS.SPEED_DATA_TIMEOUT);
    }

    return () => {
      if (timeouts.current.speedData) {
        clearTimeout(timeouts.current.speedData);
        timeouts.current.speedData = null;
      }
    };
  }, [speed, settings.minimapSpeedBased, settings.locationDisplay, checkSpeedDataStale]);

  // Speed indicator visibility logic
  useEffect(() => {
    // Reset speed indicator state when setting is disabled
    if (!settings.showSpeed) {
      resetSpeedIndicatorState();
      setSpeedIndicatorVisible(false);
      return;
    }

    // Only process speed indicator logic if speed setting is enabled
    if (settings.showSpeed) {
      const kmh = getSpeedKmh(speed);
      const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);

      if (isAboveThreshold) {
        speedIndicatorState.current.aboveThresholdCount++;
        
        // Show speed indicator when threshold is met (requires 2 readings to prevent false positives)
        if (speedIndicatorState.current.aboveThresholdCount >= 2) {
          clearTimeoutByType('speedIndicatorHide');
          
          if (!speedIndicatorState.current.visible) {
            speedIndicatorState.current.visible = true;
            setSpeedIndicatorVisible(true);
            logSpeedVisibility('shown', 'Speed indicator', kmh);
          }
        }
      } else {
        speedIndicatorState.current.aboveThresholdCount = 0;
        
        // Hide speed indicator after brief delay when speed drops below threshold
        if (speedIndicatorState.current.visible && !timeouts.current.speedIndicatorHide) {
          timeouts.current.speedIndicatorHide = setTimeout(() => {
            speedIndicatorState.current.visible = false;
            setSpeedIndicatorVisible(false);
            timeouts.current.speedIndicatorHide = null;
            logSpeedVisibility('hidden', 'Speed indicator', kmh);
          }, TIMERS.SPEED_HIDE_DELAY);
        }
      }
    }
  }, [speed, settings.showSpeed, resetSpeedIndicatorState, clearTimeoutByType, getSpeedKmh, isAboveSpeedThreshold, logSpeedVisibility]);

  // Speed indicator timeout effect - hide if no speed data for too long
  useEffect(() => {
    // Only apply timeout logic if speed setting is enabled
    if (!settings.showSpeed) {
      return;
    }

    // Check if speed data is stale (no updates for SPEED_DATA_TIMEOUT)
    const timeSinceLastSpeedUpdate = Date.now() - speedIndicatorState.current.lastSpeedUpdate;
    const isSpeedDataStale = timeSinceLastSpeedUpdate > TIMERS.SPEED_DATA_TIMEOUT;

    if (isSpeedDataStale && speedIndicatorState.current.visible) {
      // Speed data is stale and indicator is visible - hide it
      OverlayLogger.overlay('Speed indicator timeout - hiding due to stale data', { 
        timeSinceLastUpdate: timeSinceLastSpeedUpdate,
        timeout: TIMERS.SPEED_DATA_TIMEOUT 
      });
      
      speedIndicatorState.current.visible = false;
      speedIndicatorState.current.aboveThresholdCount = 0;
      setSpeedIndicatorVisible(false);
      
      // Clear any existing hide timeout
      if (timeouts.current.speedIndicatorHide) {
        clearTimeout(timeouts.current.speedIndicatorHide);
        timeouts.current.speedIndicatorHide = null;
      }
    }

    return () => {
      if (timeouts.current.speedIndicatorHide) {
        clearTimeout(timeouts.current.speedIndicatorHide);
        timeouts.current.speedIndicatorHide = null;
      }
    };
  }, [speed, settings.showSpeed]);

  useEffect(() => {
    const overlayTimeout = setTimeout(() => {
      const hasConfiguredElements = currentSettings.current.locationDisplay || 
                                   currentSettings.current.showWeather || 
                                   (currentSettings.current.showMinimap || 
                                    (currentSettings.current.minimapSpeedBased && minimapState.current.speedBasedVisible));
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      const overlayReady = hasConfiguredElements && dataReady;
      
      if (!overlayReady) {
        setIsLoading({
          weather: false,
          location: false,
          timezone: false
        });
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000);

    return () => {
      clearTimeout(overlayTimeout);
      if (minimapTimeout.current) clearTimeout(minimapTimeout.current);
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  return (
    <ErrorBoundary>
      <div id="overlay" className={overlayVisible ? 'show' : ''}>
        <div className="top-left">
          <div className="overlay-container">
            {timezone && (
              <div className="time time-left">
                <div className="time-display">
                  <span className="time-main">{time.split(' ')[0]}</span>
                  <span className="time-ampm">{time.split(' ')[1]}</span>
                </div>
              </div>
            )}
            
            {timezone && (
              <div className="date date-left">
                {date}
              </div>
            )}
            
            <HeartRateMonitor 
              pulsoidToken={API_KEYS.PULSOID} 
            />
          </div>
        </div>

        {(isLocationEnabled || settings.showWeather || (settings.showMinimap || settings.minimapSpeedBased)) && (
          <div className="top-right">
            <div className="overlay-container">
              {settings.locationDisplay && settings.locationDisplay !== 'hidden' && location && location.label && (
                <div className="location">
                  {location.label}
                  {location.countryCode && (
                    <img
                      src={`https://flagcdn.com/${location.countryCode}.svg`}
                      alt={`Country: ${location.label}`}
                      width={32}
                      height={20}
                      className="location-flag"
                    />
                  )}
                </div>
              )}
              
              {settings.showWeather && (
                <div className="weather">
                  {isLoading.weather ? (
                    <div className="weather-container">
                      <div className="weather-content">
                        <div className="weather-description">Loading weather...</div>
                        <div className="weather-temperature">--°C / --°F</div>
                      </div>
                    </div>
                  ) : weather ? (
                    <div className="weather-container">
                      <div className="weather-content">
                        <div className="weather-description">
                          {weather.desc.toUpperCase()}
                        </div>
                        <div 
                          className="weather-temperature"
                          style={{ 
                            color: getTemperatureZone(weather.temp).color,
                            transition: 'color 0.5s ease'
                          }}
                        >
                          {weather.temp}°C / {celsiusToFahrenheit(weather.temp)}°F
                        </div>
                      </div>
                      <div className="weather-icon">
                        <img
                          src={`https://openweathermap.org/img/wn/${weatherIcon || '01d'}@4x.png`}
                          alt={`Weather: ${weather.desc}`}
                          width={24}
                          height={24}
                          className="weather-icon"
                          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                            // Fallback to a simple text representation if image fails
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            
                            // Show loading briefly, then fallback
                            const fallback = document.createElement('div');
                            fallback.className = 'weather-icon-fallback';
                            fallback.textContent = '⏳'; // Loading indicator
                            target.parentNode?.appendChild(fallback);
                            
                            // Replace with actual fallback after brief delay
                            setTimeout(() => {
                              fallback.textContent = weather?.icon ? getWeatherFallback(weather.icon) : '🌤️';
                            }, 100);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              
              {/* Speed Indicator */}
              {settings.showSpeed && speedIndicatorVisible && (
                <div className="speed-indicator">
                  <div className="speed-value">
                    {speedRounded} km/h
                  </div>
                </div>
              )}
            </div>

            {shouldShowMinimap() && (
              <div className="minimap" style={{ opacity: minimapOpacity, transition: 'opacity 0.2s ease-in-out' }}>
                {mapCoords ? (
                  <MapboxMinimap 
                    lat={mapCoords[0]} 
                    lon={mapCoords[1]} 
                    isVisible={true}
                  />
                ) : (
                  <div className="minimap-placeholder">
                    <div className="placeholder-content">
                      <div className="placeholder-icon">🗺️</div>
                      <div className="placeholder-text">
                        {settings.minimapSpeedBased ? 'Waiting for movement...' : 'Waiting for GPS...'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

                 <KickSubGoal 
           channelName={safeSettings.kickChannelName}
           dailyGoal={safeSettings.kickDailySubGoal}
           isVisible={safeSettings.showKickSubGoal}
           showLatestSub={safeSettings.showLatestSub}
           showLeaderboard={safeSettings.showSubLeaderboard}
           enableRollingSubGoal={safeSettings.enableRollingSubGoal}
           rollingSubGoalIncrement={safeSettings.rollingSubGoalIncrement}
           subGoalData={subGoalData}
         />
      </div>
    </ErrorBoundary>
  );
}


