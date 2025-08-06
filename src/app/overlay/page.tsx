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
  LocationData,
} from '@/utils/overlay-utils';
import { OverlayLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';

// Import extracted utilities and constants
import { 
  TIMERS, 
  THRESHOLDS, 
  API_KEYS,
  type RTIRLPayload
} from '@/utils/overlay-constants';
import {
  kmhToMph,
  getAdaptiveDistanceThreshold,
  createSpeedAnimation,
  getSpeedKmh,
  isAboveSpeedThreshold,
  logSpeedVisibility
} from '@/utils/speed-utils';
import {
  getWeatherIcon,
  getWeatherFallback,
  celsiusToFahrenheit
} from '@/utils/weather-utils';

const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});









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
  const [smoothSpeed, setSmoothSpeed] = useState(0);
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
  // Unified state management for speed-based elements
  const speedBasedElements = useRef({
    minimap: {
      visible: false,
      aboveThresholdCount: 0,
      lastSpeedUpdate: 0,
      currentMode: 'hidden' as 'hidden' | 'manual' | 'speed-based'
    },
    speedIndicator: {
      visible: false,
      aboveThresholdCount: 0,
      lastSpeedUpdate: 0
    }
  });
  
  // Unified timeout management
  const timeouts = useRef({
    speedHide: null as NodeJS.Timeout | null,
    speedData: null as NodeJS.Timeout | null,
    speedIndicatorHide: null as NodeJS.Timeout | null,
    minimap: null as NodeJS.Timeout | null,
    overlay: null as NodeJS.Timeout | null
  });
  
  // Animation management
  const speedAnimationRef = useRef<(() => void) | null>(null);
  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);
  const isFirstLoad = useRef(true); // Track if this is the first load
  const timeIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      minimap: null,
      overlay: null
    };
    
    // Clear speed animation
    if (speedAnimationRef.current) {
      speedAnimationRef.current();
      speedAnimationRef.current = null;
    }
  }, []);

  // Optimized timeout cleanup for specific timeout types
  const clearTimeoutByType = useCallback((type: keyof typeof timeouts.current) => {
    if (timeouts.current[type]) {
      clearTimeout(timeouts.current[type]!);
      timeouts.current[type] = null;
    }
  }, []);

  const resetMinimapState = useCallback((mode: 'hidden' | 'manual' | 'speed-based') => {
    speedBasedElements.current.minimap = {
      visible: false,
      aboveThresholdCount: 0,
      lastSpeedUpdate: speedBasedElements.current.minimap.lastSpeedUpdate,
      currentMode: mode
    };
    clearAllTimeouts();
    
    OverlayLogger.overlay(`Minimap state reset to mode: ${mode}`, {
      previousMode: speedBasedElements.current.minimap.currentMode,
      newMode: mode
    });
  }, [clearAllTimeouts]);

  const updateSpeedData = useCallback((newSpeed: number) => {
    const now = Date.now();
    speedBasedElements.current.minimap.lastSpeedUpdate = now;
    speedBasedElements.current.speedIndicator.lastSpeedUpdate = now;
    
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
    const timeSinceLastUpdate = Date.now() - speedBasedElements.current.minimap.lastSpeedUpdate;
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



  // Speed indicator helper functions
  const resetSpeedIndicatorState = useCallback(() => {
    speedBasedElements.current.speedIndicator = {
      visible: false,
      aboveThresholdCount: 0,
      lastSpeedUpdate: speedBasedElements.current.speedIndicator.lastSpeedUpdate
    };
    
    if (timeouts.current.speedIndicatorHide) {
      clearTimeout(timeouts.current.speedIndicatorHide);
      timeouts.current.speedIndicatorHide = null;
    }
    
    OverlayLogger.overlay('Speed indicator state reset', {
      previousVisible: speedBasedElements.current.speedIndicator.visible,
      newVisible: false
    });
  }, []);

  // Simplified speed animation using utility
  const animateSpeed = useCallback((fromSpeed: number, toSpeed: number) => {
    // Clear any existing animation
    if (speedAnimationRef.current) {
      speedAnimationRef.current();
      speedAnimationRef.current = null;
    }
    
    const cleanup = createSpeedAnimation(
      fromSpeed,
      toSpeed,
      setSmoothSpeed,
      () => setSmoothSpeed(toSpeed)
    );
    
    // Store cleanup function reference
    speedAnimationRef.current = cleanup;
    
    return cleanup;
  }, []);

  const updateSpeedIndicatorData = useCallback((newSpeed: number) => {
    const now = Date.now();
    speedBasedElements.current.speedIndicator.lastSpeedUpdate = now;
    
    OverlayLogger.overlay('Speed indicator data updated', {
      speed: newSpeed,
      timestamp: now
    });
  }, []);


  
  // Memoized smooth speed display values
  const smoothSpeedKmh = useMemo(() => Math.round(smoothSpeed), [smoothSpeed]);
  const smoothSpeedMph = useMemo(() => Math.round(kmhToMph(smoothSpeed)), [smoothSpeed]);



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
  }, [settings.locationDisplay, processWeatherResult, setLoadingState, createDateTimeFormatters, speed]);

  const shouldShowMinimap = useCallback(() => {
    // If location is hidden, never show minimap
    if (settings.locationDisplay === 'hidden') {
      return false;
    }
    
    // If speed-based mode is enabled, show only when moving
    if (settings.minimapSpeedBased) {
      return speedBasedElements.current.minimap.visible && mapCoords;
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
            // Debug logging for speed calculation
            const rawSpeed = payload.speed;
            const speedKmh = rawSpeed * 3.6;
            const speedMph = speedKmh * 0.621371;
            
            OverlayLogger.overlay('RTIRL Speed Data Debug', {
              rawSpeed,
              speedKmh: Math.round(speedKmh * 10) / 10,
              speedMph: Math.round(speedMph * 10) / 10,
              timestamp: Date.now()
            });
            
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
            if (timeouts.current.minimap) {
              clearTimeout(timeouts.current.minimap);
            }
            if (!currentSettings.current.showMinimap) {
              timeouts.current.minimap = setTimeout(() => {
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
    if (timeouts.current.minimap) {
      clearTimeout(timeouts.current.minimap);
      timeouts.current.minimap = null;
    }
    
    // If minimap should be hidden and we have coordinates, set a timeout to clear them
    if (!shouldShowMinimap() && mapCoords) {
      timeouts.current.minimap = setTimeout(() => {
        setMapCoords(null);
      }, TIMERS.MINIMAP_HIDE_DELAY);
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, mapCoords, shouldShowMinimap]);

  // Minimap visibility logic - requires 2 successful polls and hides after timeout
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
        speedBasedElements.current.minimap.aboveThresholdCount++;
        
        // Show minimap when threshold is met (requires 2 readings to prevent false positives)
        if (speedBasedElements.current.minimap.aboveThresholdCount >= THRESHOLDS.SPEED_READINGS_REQUIRED) {
          clearTimeoutByType('speedHide');
          
          if (!speedBasedElements.current.minimap.visible) {
            speedBasedElements.current.minimap.visible = true;
            setMinimapOpacity(1);
            logSpeedVisibility('shown', 'Minimap', kmh);
          }
        }
      } else {
        speedBasedElements.current.minimap.aboveThresholdCount = 0;
        
        // Hide minimap after brief delay when speed drops below threshold
        if (speedBasedElements.current.minimap.visible && !timeouts.current.speedHide) {
          timeouts.current.speedHide = setTimeout(() => {
            speedBasedElements.current.minimap.visible = false;
            setMinimapOpacity(0);
            timeouts.current.speedHide = null;
            logSpeedVisibility('hidden', 'Minimap', kmh);
          }, TIMERS.SPEED_HIDE_DELAY);
        }
      }
    }
  }, [speed, settings.minimapSpeedBased, settings.locationDisplay, resetMinimapState, clearTimeoutByType]);

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

    if (isStale && speedBasedElements.current.minimap.visible) {
      // Speed data is stale and minimap is visible - hide it
      OverlayLogger.overlay('Speed data timeout - hiding minimap due to stale data', { 
        timeSinceLastUpdate,
        timeout: TIMERS.SPEED_DATA_TIMEOUT 
      });
      
      speedBasedElements.current.minimap.visible = false;
      speedBasedElements.current.minimap.aboveThresholdCount = 0;
      setMinimapOpacity(0);
      
      // Clear any existing hide timeout
      if (timeouts.current.speedHide) {
        clearTimeout(timeouts.current.speedHide);
        timeouts.current.speedHide = null;
      }
    } else if (!isStale && speedBasedElements.current.minimap.visible) {
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

  // Speed indicator visibility logic - requires 2 successful polls and hides after timeout
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
        speedBasedElements.current.speedIndicator.aboveThresholdCount++;
        
        // Show speed indicator when threshold is met (requires 2 readings to prevent false positives)
        if (speedBasedElements.current.speedIndicator.aboveThresholdCount >= THRESHOLDS.SPEED_READINGS_REQUIRED) {
          clearTimeoutByType('speedIndicatorHide');
          
          if (!speedBasedElements.current.speedIndicator.visible) {
            speedBasedElements.current.speedIndicator.visible = true;
            setSpeedIndicatorVisible(true);
            logSpeedVisibility('shown', 'Speed indicator', kmh);
          }
        }
      } else {
        speedBasedElements.current.speedIndicator.aboveThresholdCount = 0;
        
        // Hide speed indicator after brief delay when speed drops below threshold
        if (speedBasedElements.current.speedIndicator.visible && !timeouts.current.speedIndicatorHide) {
          timeouts.current.speedIndicatorHide = setTimeout(() => {
            speedBasedElements.current.speedIndicator.visible = false;
            setSpeedIndicatorVisible(false);
            timeouts.current.speedIndicatorHide = null;
            logSpeedVisibility('hidden', 'Speed indicator', kmh);
          }, TIMERS.SPEED_HIDE_DELAY);
        }
      }
    }
  }, [speed, settings.showSpeed, resetSpeedIndicatorState, clearTimeoutByType]);

  // Speed indicator timeout effect - hide if no speed data for too long
  useEffect(() => {
    if (!settings.showSpeed) return;

    const timeSinceLastUpdate = Date.now() - speedBasedElements.current.speedIndicator.lastSpeedUpdate;
    const isStale = timeSinceLastUpdate > TIMERS.SPEED_DATA_TIMEOUT;

    if (isStale && speedBasedElements.current.speedIndicator.visible) {
      OverlayLogger.overlay('Speed indicator timeout - hiding due to stale data', { 
        timeSinceLastUpdate,
        timeout: TIMERS.SPEED_DATA_TIMEOUT 
      });
      
      speedBasedElements.current.speedIndicator.visible = false;
      speedBasedElements.current.speedIndicator.aboveThresholdCount = 0;
      setSpeedIndicatorVisible(false);
      
      clearTimeoutByType('speedIndicatorHide');
    }
  }, [speed, settings.showSpeed, clearTimeoutByType]);

  // Optimized smooth speed transitions
  useEffect(() => {
    if (speed > 0 && speedIndicatorVisible) {
      const currentSpeed = smoothSpeed || speed;
      const targetSpeed = speed;
      
      // Use optimized animation function
      const cleanup = animateSpeed(currentSpeed, targetSpeed);
      
      return cleanup;
    }
  }, [speed, speedIndicatorVisible, smoothSpeed, animateSpeed]);



  // Overlay visibility timeout
  useEffect(() => {
    const overlayTimeout = setTimeout(() => {
      const hasConfiguredElements = currentSettings.current.locationDisplay || 
                                   currentSettings.current.showWeather || 
                                   (currentSettings.current.showMinimap || 
                                    (currentSettings.current.minimapSpeedBased && speedBasedElements.current.minimap.visible));
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      if (!hasConfiguredElements || !dataReady) {
        setIsLoading({ weather: false, location: false, timezone: false });
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000);

    return () => {
      clearTimeout(overlayTimeout);
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
                        <div className="weather-temperature">
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
                  <div className="speed-content">
                    <div className="speed-value">
                      {smoothSpeedMph}
                    </div>
                    <div className="speed-label">
                      MPH
                    </div>
                  </div>
                  <div className="speed-separator">/</div>
                  <div className="speed-content">
                    <div className="speed-value">
                      {smoothSpeedKmh}
                    </div>
                    <div className="speed-label">
                      KM/H
                    </div>
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
           channelName={settings.kickChannelName}
           dailyGoal={settings.kickDailySubGoal}
           isVisible={settings.showKickSubGoal}
           showLatestSub={settings.showLatestSub}
           showLeaderboard={settings.showSubLeaderboard}
           enableRollingSubGoal={settings.enableRollingSubGoal}
           rollingSubGoalIncrement={settings.rollingSubGoalIncrement}
           subGoalData={subGoalData}
         />
      </div>
    </ErrorBoundary>
  );
}


