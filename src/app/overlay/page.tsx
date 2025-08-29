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

import { 
  fetchWeatherAndTimezoneFromOpenMeteo,
  fetchLocationFromLocationIQ,
  fetchLocationFromMapbox,
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
  getSpeedKmh,
  isAboveSpeedThreshold,
  checkSpeedDataStale
} from '@/utils/speed-utils';
import {
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
  const [location, setLocation] = useState<{ 
    label: string; 
    line2?: string;
    countryCode: string; 
    originalData?: LocationData 
  } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [speedIndicatorVisible, setSpeedIndicatorVisible] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [minimapOpacity, setMinimapOpacity] = useState(1);
  const [isLoading, setIsLoading] = useState({
    weather: true,
    location: true,
    timezone: true
  });
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);


  // Add refs to track last update times for auto-hide functionality
  const lastSpeedUpdate = useRef(0);
  const lastMinimapUpdate = useRef(0);
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  const minimapHideTimeout = useRef<NodeJS.Timeout | null>(null);

  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastLocationCoords = useRef<[number, number] | null>(null);
  const lastLocationAPICall = useRef(0);
  const weatherTimerRef = useRef<NodeJS.Timeout | null>(null);
  const weatherPollMsRef = useRef<number>(TIMERS.WEATHER_TIMEZONE_UPDATE);

  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  const isFirstLoad = useRef(true); // Track if this is the first load
  const timeIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    
    // Store coordinates for location updates
    const previousWeatherCoords = lastWeatherCoords.current;
    lastWeatherCoords.current = [lat, lon];
    
    // On first load, always fetch fresh data
    const isFirstLoadNow = isFirstLoad.current;
    if (isFirstLoadNow) {
      isFirstLoad.current = false;
      OverlayLogger.overlay('First load detected - fetching fresh API data immediately', { lat, lon });
      
      // Fetch initial weather data
      try {
        OverlayLogger.overlay('Fetching initial weather data from API', { lat, lon });
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        await processWeatherResult(result, true);
      } catch (error) {
        OverlayLogger.error('Initial weather update failed', error);
        setWeather(null);
        setLoadingState('weather', false);
      }
    }
    
    // If we've moved a large distance, force a weather refresh immediately
    if (previousWeatherCoords) {
      const movedMeters = distanceInMeters(lat, lon, previousWeatherCoords[0], previousWeatherCoords[1]);
      if (movedMeters >= THRESHOLDS.WEATHER_DISTANCE_KM * 1000) {
        try {
          OverlayLogger.overlay('Large movement detected, refreshing weather now', { movedMeters });
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result);
          weatherPollMsRef.current = TIMERS.WEATHER_TIMEZONE_UPDATE;
        } catch (error) {
          OverlayLogger.error('Immediate weather refresh after movement failed', error);
        }
      }
    }

    // Fetch location name data - ALWAYS fetch on first load, then use thresholds
    const now = Date.now();
    const distanceThreshold = THRESHOLDS.LOCATION_DISTANCE; // meters
    const timeThreshold = TIMERS.LOCATION_UPDATE; // ms
    
    // Add additional debounce to prevent rapid successive calls
    const minTimeBetweenCalls = 10000; // Minimum 10 seconds between any location API calls
    const timeSinceLastCall = now - lastLocationAPICall.current;
    
    // Check if user is moving too fast (which could cause rapid coordinate changes)
    const isMovingFast = lastLocationCoords.current && 
      distanceInMeters(lat, lon, lastLocationCoords.current![0], lastLocationCoords.current![1]) > 5000; // 5km threshold
    
    // Force location update on first load, regardless of thresholds
    // But be more conservative if moving fast to prevent rate limit issues
    const shouldUpdateLocation = isFirstLoadNow || !lastLocationCoords.current || (
      distanceInMeters(lat, lon, lastLocationCoords.current![0], lastLocationCoords.current![1]) >= distanceThreshold &&
      timeSinceLastCall >= timeThreshold &&
      timeSinceLastCall >= minTimeBetweenCalls && // Additional debounce
      !isMovingFast // Don't update if moving too fast
    );
    
    if (shouldUpdateLocation) {
      lastLocationCoords.current = [lat, lon];
      lastLocationAPICall.current = now;
      
      OverlayLogger.overlay('Location update conditions met', {
        isFirstLoad: isFirstLoadNow,
        distanceMoved: lastLocationCoords.current ? 
          distanceInMeters(lat, lon, lastLocationCoords.current[0], lastLocationCoords.current[1]) : 0,
        timeSinceLastCall,
        isMovingFast: isMovingFast || false
      });
      
      if (API_KEYS.LOCATIONIQ) {
        try {
          OverlayLogger.overlay('Fetching location name from LocationIQ (primary)', { lat, lon, service: 'LocationIQ' });
          const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
          if (loc) {
            setLocation({ 
              label: formatLocation(loc, settings.locationDisplay).line1, 
              line2: formatLocation(loc, settings.locationDisplay).line2,
              countryCode: loc.countryCode || '', 
              originalData: loc 
            });
            
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
            // LocationIQ returned null (likely rate limited) - fallback will be used
            OverlayLogger.overlay('LocationIQ returned null - Mapbox fallback will be used', { 
              reason: 'Rate limited or daily limit reached',
              fallback: 'Mapbox'
            });
          }
        } catch (error) {
          OverlayLogger.error(`LocationIQ API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      // Try Mapbox as fallback if LocationIQ failed or isn't available
      if (API_KEYS.MAPBOX) {
        try {
          OverlayLogger.overlay('Trying Mapbox fallback for location data', { 
            lat, 
            lon, 
            reason: 'LocationIQ failed or rate limited',
            fallbackService: 'Mapbox'
          });
          const loc = await fetchLocationFromMapbox(lat, lon, API_KEYS.MAPBOX);
          if (loc) {
            setLocation({ 
              label: formatLocation(loc, settings.locationDisplay).line1, 
              line2: formatLocation(loc, settings.locationDisplay).line2,
              countryCode: loc.countryCode || '', 
              originalData: loc 
            });
            OverlayLogger.overlay('Location data received from Mapbox fallback', { 
              location: loc,
              service: 'Mapbox',
              fallback: true
            });
            return; // Success, exit early
          } else {
            OverlayLogger.warn('Mapbox fallback also returned null');
          }
        } catch (error) {
          OverlayLogger.error(`Mapbox API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      // If both APIs failed, set loading to false
      if (!API_KEYS.LOCATIONIQ && !API_KEYS.MAPBOX) {
        OverlayLogger.warn('No location API keys available');
      } else {
        OverlayLogger.warn('All location APIs failed');
      }
      setLoadingState('location', false);
    }
  }, [settings.locationDisplay, processWeatherResult, setLoadingState, createDateTimeFormatters, setLocation]);

  // Update location display when display mode changes
  useEffect(() => {
    if (location?.originalData) {
      const locationDisplay = formatLocation(location.originalData, settings.locationDisplay);
      setLocation(prev => prev ? { 
        ...prev, 
        label: locationDisplay.line1,
        line2: locationDisplay.line2
      } : null);
    }
  }, [settings.locationDisplay, location?.originalData]);



  // Force location refresh when display mode changes (e.g., switching from State to City mode)
  useEffect(() => {
    if (mapCoords && location?.originalData) {
      // Add debounce to prevent rapid mode changes from triggering multiple API calls
      const now = Date.now();
      const timeSinceLastModeChange = now - lastLocationAPICall.current;
      const minTimeForModeChange = 30000; // 30 seconds minimum between mode change refreshes
      
      if (timeSinceLastModeChange >= minTimeForModeChange) {
        OverlayLogger.overlay('Location display mode changed - refreshing location data', { 
          newMode: settings.locationDisplay,
          coords: mapCoords,
          timeSinceLastCall: timeSinceLastModeChange
        });
        
        // Force a fresh location API call by clearing the cache
        lastLocationCoords.current = null;
        lastLocationAPICall.current = 0;
        
        // Trigger location update with current coordinates
        updateFromCoordinates(mapCoords[0], mapCoords[1]);
      } else {
        OverlayLogger.overlay('Location display mode changed but skipping refresh due to recent API call', {
          newMode: settings.locationDisplay,
          timeSinceLastCall: timeSinceLastModeChange,
          minTimeRequired: minTimeForModeChange
        });
      }
    }
  }, [settings.locationDisplay, mapCoords, location?.originalData, updateFromCoordinates]);

  const shouldShowMinimap = useCallback(() => {
    // If location is hidden, never show minimap
    if (settings.locationDisplay === 'hidden') {
      return false;
    }
    
    // If speed-based mode is enabled, show only when moving
    if (settings.minimapSpeedBased) {
      return minimapOpacity > 0 && mapCoords;
    }
    
    // If manual mode is enabled, show when we have coordinates
    if (settings.showMinimap) {
      return mapCoords !== null;
    }
    
    // Default: don't show
    return false;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, minimapOpacity]);

  const isLocationEnabled = settings.locationDisplay && settings.locationDisplay !== 'hidden';
  const isOverlayReady = useMemo(() => !isLoading.timezone, [isLoading.timezone]);

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
    // Update minimap visibility when settings change
    if (settings.locationDisplay === 'hidden') {
      // Location is hidden: force hide minimap
      setMinimapOpacity(0);
    } else if (settings.minimapSpeedBased) {
      // Speed-based mode: visibility controlled by speed threshold
      // (handled by the speed effect)
    } else if (settings.showMinimap) {
      // Manual mode: show if we have coordinates
      setMinimapOpacity(mapCoords ? 1 : 0);
    } else {
      // Hidden mode: ensure hidden
      setMinimapOpacity(0);
    }
  }, [settings.minimapSpeedBased, settings.showMinimap, settings.locationDisplay, mapCoords]);

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

  // Force fresh location data fetch when page loads
  useEffect(() => {
    // Reset first load flag when component mounts
    isFirstLoad.current = true;
    
    // Clear any cached location data
    lastLocationCoords.current = null;
    lastLocationAPICall.current = 0;
    
    OverlayLogger.overlay('Page loaded - forcing fresh location data fetch on next coordinates');
  }, []);

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

  // Periodic weather updates with backoff
  useEffect(() => {
    function clearWeatherTimer() {
      if (weatherTimerRef.current) {
        clearTimeout(weatherTimerRef.current);
        weatherTimerRef.current = null;
      }
    }

    async function tick() {
      if (!lastWeatherCoords.current) return;
      const [lat, lon] = lastWeatherCoords.current;
      try {
        OverlayLogger.overlay('Scheduled weather update', { lat, lon });
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        await processWeatherResult(result);
        // Reset poll interval on success
        weatherPollMsRef.current = TIMERS.WEATHER_TIMEZONE_UPDATE;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        OverlayLogger.error(`Scheduled weather update failed: ${errorMessage}`);
        setWeather(null);
        setLoadingState('weather', false);
        // Exponential backoff within bounds
        const next = Math.min(
          Math.max(weatherPollMsRef.current * 2, TIMERS.WEATHER_BACKOFF_MIN),
          TIMERS.WEATHER_BACKOFF_MAX
        );
        weatherPollMsRef.current = next;
      } finally {
        // Schedule next
        clearWeatherTimer();
        weatherTimerRef.current = setTimeout(tick, weatherPollMsRef.current + Math.floor(Math.random() * 0.1 * weatherPollMsRef.current));
      }
    }

    // Start schedule when coords first available
    if (lastWeatherCoords.current && !weatherTimerRef.current) {
      weatherTimerRef.current = setTimeout(tick, TIMERS.WEATHER_TIMEZONE_UPDATE);
    }

    return () => {
      clearWeatherTimer();
    };
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
          if (!p || typeof p !== 'object') {
            OverlayLogger.warn('RTIRL received invalid payload', { payload: p });
            return;
          }
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
            
            // Update speed and track timestamp for auto-hide
            setSpeed(payload.speed);
            lastSpeedUpdate.current = Date.now();
            
            // Clear any existing speed hide timeout since we got new data
            if (speedHideTimeout.current) {
              clearTimeout(speedHideTimeout.current);
              speedHideTimeout.current = null;
            }
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
            
            // Track minimap update timestamp for auto-hide
            lastMinimapUpdate.current = Date.now();
            

            
            // Clear any existing minimap hide timeout since we got new data
            if (minimapHideTimeout.current) {
              clearTimeout(minimapHideTimeout.current);
              minimapHideTimeout.current = null;
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
  }, [updateFromCoordinates, createDateTimeFormatters, setLoadingState]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/get-settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        if (data) {
          setSettings(data);
          

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



  // Auto-hide logic for speed indicator and minimap
  useEffect(() => {
    // Clear existing timeouts
    if (speedHideTimeout.current) {
      clearTimeout(speedHideTimeout.current);
      speedHideTimeout.current = null;
    }
    if (minimapHideTimeout.current) {
      clearTimeout(minimapHideTimeout.current);
      minimapHideTimeout.current = null;
    }

    // Check if speed data is stale
    const { isStale: speedStale } = checkSpeedDataStale(lastSpeedUpdate.current);
    const { isStale: minimapStale } = checkSpeedDataStale(lastMinimapUpdate.current);



    // Speed indicator visibility logic
    if (!settings.showSpeed) {
      setSpeedIndicatorVisible(false);
    } else {
      const kmh = getSpeedKmh(speed);
      const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);
      
      if (isAboveThreshold && !speedStale) {
        setSpeedIndicatorVisible(true);
        // Set timeout to hide after 10 seconds of no new data
        speedHideTimeout.current = setTimeout(() => {
          setSpeedIndicatorVisible(false);
          OverlayLogger.overlay('Speed indicator auto-hidden due to stale data');
        }, TIMERS.SPEED_HIDE_DELAY);
      } else {
        setSpeedIndicatorVisible(false);
      }
    }

    // Minimap visibility logic
    if (settings.locationDisplay === 'hidden') {
      setMinimapOpacity(0);
    } else if (settings.minimapSpeedBased) {
      // Speed-based mode: show only when moving
      const kmh = getSpeedKmh(speed);
      const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);
      
      if (isAboveThreshold && !speedStale && !minimapStale) {
        setMinimapOpacity(1);
        // Set timeout to hide after 10 seconds of no new data
        minimapHideTimeout.current = setTimeout(() => {
          setMinimapOpacity(0);
          OverlayLogger.overlay('Minimap auto-hidden due to stale data');
        }, TIMERS.MINIMAP_HIDE_DELAY);
      } else {
        setMinimapOpacity(0);
      }
    } else if (settings.showMinimap) {
      // Manual mode: show when we have coordinates
      setMinimapOpacity(mapCoords ? 1 : 0);
    } else {
      // Hidden mode
      setMinimapOpacity(0);
    }

    // Cleanup function
    return () => {
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
      }
      if (minimapHideTimeout.current) {
        clearTimeout(minimapHideTimeout.current);
      }
    };
  }, [speed, settings.showSpeed, settings.minimapSpeedBased, settings.locationDisplay, settings.showMinimap, mapCoords]);

  // Periodic stale data check to trigger auto-hide
  useEffect(() => {
    const staleDataCheck = setInterval(() => {
      const { isStale: speedStale } = checkSpeedDataStale(lastSpeedUpdate.current);
      const { isStale: minimapStale } = checkSpeedDataStale(lastMinimapUpdate.current);
      

      
      if (speedStale && speedIndicatorVisible) {
        setSpeedIndicatorVisible(false);
        OverlayLogger.overlay('Speed indicator hidden due to stale data check');
      }
      
      if ((speedStale || minimapStale) && minimapOpacity > 0) {
        setMinimapOpacity(0);
        OverlayLogger.overlay('Minimap hidden due to stale data check');
      }
      

    }, 10000); // Check every 10 seconds

    return () => clearInterval(staleDataCheck);
  }, [speedIndicatorVisible, minimapOpacity]);

  // Simplified speed display - no animation, just show raw speed
  const currentSpeedKmh = useMemo(() => getSpeedKmh(speed), [speed]);
  const currentSpeedMph = useMemo(() => Math.round(kmhToMph(currentSpeedKmh)), [currentSpeedKmh]);
  const displaySpeedKmh = useMemo(() => Math.round(currentSpeedKmh), [currentSpeedKmh]);

  

  // Overlay visibility timeout - simplified
  useEffect(() => {
    const overlayTimeout = setTimeout(() => {
      const hasElements = currentSettings.current.locationDisplay || 
                         currentSettings.current.showWeather || 
                         currentSettings.current.showMinimap || 
                         currentSettings.current.minimapSpeedBased;
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      if (!hasElements || !dataReady) {
        setIsLoading({ weather: false, location: false, timezone: false });
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000);

    return () => clearTimeout(overlayTimeout);
  }, [minimapOpacity]);

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
                  {location.line2 && `, ${location.line2}`}
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
                    </div>
                  ) : null}
                </div>
              )}
              
              {/* Speed Indicator */}
              {settings.showSpeed && speedIndicatorVisible && (
                <div className="speed-indicator">
                  <div className="speed-content">
                    <div className="speed-value">
                      {currentSpeedMph}
                    </div>
                    <div className="speed-label">
                      MPH
                    </div>
                  </div>
                  <div className="speed-separator">/</div>
                  <div className="speed-content">
                    <div className="speed-value">
                      {displaySpeedKmh}
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
                    speedKmh={currentSpeedKmh}
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
      </div>
    </ErrorBoundary>
  );
}


