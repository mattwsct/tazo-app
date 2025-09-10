"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit } from '@/utils/unit-conversions';
import { API_KEYS, THRESHOLDS, TIMERS, API_RATE_LIMITS, type RTIRLPayload } from '@/utils/overlay-constants';
import { distanceInMeters } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenMeteo, fetchLocationFromLocationIQ, fetchLocationFromMapbox } from '@/utils/api-utils';
import { formatLocation, type LocationData } from '@/utils/location-utils';

declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

// MapboxMinimap component - Static map images
const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div className="minimap-placeholder" />
});

const HeartRateMonitor = dynamic(() => import('@/components/HeartRateMonitor'), {
  ssr: false,
  loading: () => null
});

export default function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // State
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState<{ 
    label: string; 
    context?: string;
    countryCode: string; 
  } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  // Removed isLoading state - using Option 1: hide until ready

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const settingsRef = useRef(settings);
  const periodicLocationTimer = useRef<NodeJS.Timeout | null>(null);
  
  // API rate limiting tracking
  const locationIqCalls = useRef(0);
  const mapboxCalls = useRef(0);
  const lastLocationIqCall = useRef(0);
  const lastMapboxCall = useRef(0);
  const dailyResetTime = useRef(Date.now());
  
  // Health monitoring
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [isHealthy, setIsHealthy] = useState(true);
  
  // Update settings ref whenever settings change
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Safe API call wrapper to prevent silent failures
  const safeApiCall = useCallback(async (apiCall: () => Promise<unknown>, context: string): Promise<unknown> => {
    try {
      const result = await apiCall();
      return result;
    } catch (error) {
      OverlayLogger.error(`${context} failed`, error);
      return null;
    }
  }, []);

  // Detect location granularity and determine appropriate update thresholds
  const getLocationUpdateThresholds = useCallback((locationData: LocationData | null) => {
    if (!locationData) {
      return {
        distanceThreshold: THRESHOLDS.LOCATION_DISTANCE_DEFAULT,
        timeThreshold: 300000, // 5 minutes default
        granularity: 'unknown'
      };
    }

    // Determine granularity based on available data
    let granularity = 'country';
    let distanceThreshold: number = THRESHOLDS.LOCATION_DISTANCE_STATE;
    let timeThreshold = 600000; // 10 minutes for countries/states

    if (locationData.neighbourhood || locationData.suburb) {
      granularity = 'neighbourhood';
      distanceThreshold = THRESHOLDS.LOCATION_DISTANCE_NEIGHBORHOOD;
      timeThreshold = 120000; // 2 minutes for neighborhoods
    } else if (locationData.town || locationData.municipality) {
      granularity = 'suburb';
      distanceThreshold = THRESHOLDS.LOCATION_DISTANCE_SUBURB;
      timeThreshold = 180000; // 3 minutes for suburbs
    } else if (locationData.city) {
      granularity = 'city';
      distanceThreshold = THRESHOLDS.LOCATION_DISTANCE_CITY;
      timeThreshold = 300000; // 5 minutes for cities
    } else if (locationData.state || locationData.province) {
      granularity = 'state';
      distanceThreshold = THRESHOLDS.LOCATION_DISTANCE_STATE;
      timeThreshold = 600000; // 10 minutes for states
    }

    return {
      distanceThreshold,
      timeThreshold,
      granularity
    };
  }, []);

  // Check API rate limits for free tiers
  const canMakeApiCall = useCallback((apiType: 'locationiq' | 'mapbox') => {
    const now = Date.now();
    
    // Reset daily counters if 24 hours have passed
    if (now - dailyResetTime.current > 86400000) {
      locationIqCalls.current = 0;
      mapboxCalls.current = 0;
      dailyResetTime.current = now;
    }

    if (apiType === 'locationiq') {
      const timeSinceLastCall = now - lastLocationIqCall.current;
      const cooldown = API_RATE_LIMITS.LOCATIONIQ_FREE.COOLDOWN_MS;
      
      if (locationIqCalls.current >= API_RATE_LIMITS.LOCATIONIQ_FREE.DAILY_LIMIT) {
        OverlayLogger.warn('LocationIQ daily limit reached', {
          calls: locationIqCalls.current,
          limit: API_RATE_LIMITS.LOCATIONIQ_FREE.DAILY_LIMIT
        });
        return false;
      }
      
      if (timeSinceLastCall < cooldown) {
        OverlayLogger.warn('LocationIQ rate limit - too soon', {
          timeSinceLastCall,
          cooldown
        });
        return false;
      }
      
      return true;
    } else if (apiType === 'mapbox') {
      const timeSinceLastCall = now - lastMapboxCall.current;
      const cooldown = API_RATE_LIMITS.MAPBOX_FREE.COOLDOWN_MS;
      
      if (mapboxCalls.current >= API_RATE_LIMITS.MAPBOX_FREE.DAILY_LIMIT) {
        OverlayLogger.warn('Mapbox daily limit reached', {
          calls: mapboxCalls.current,
          limit: API_RATE_LIMITS.MAPBOX_FREE.DAILY_LIMIT
        });
        return false;
      }
      
      if (timeSinceLastCall < cooldown) {
        OverlayLogger.warn('Mapbox rate limit - too soon', {
          timeSinceLastCall,
          cooldown
        });
        return false;
      }
      
      return true;
    }
    
    return false;
  }, []);

  // Track API call
  const trackApiCall = useCallback((apiType: 'locationiq' | 'mapbox') => {
    const now = Date.now();
    if (apiType === 'locationiq') {
      locationIqCalls.current++;
      lastLocationIqCall.current = now;
    } else if (apiType === 'mapbox') {
      mapboxCalls.current++;
      lastMapboxCall.current = now;
    }
  }, []);

  // Health monitoring - detect when updates stop and prevent long-running issues
  useEffect(() => {
    const sessionStartTime = Date.now();
    
    const healthCheck = () => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      const sessionDuration = Date.now() - sessionStartTime;
      
      if (timeSinceLastUpdate > 120000) { // 2 minutes without update
        OverlayLogger.warn('Overlay appears unhealthy - no updates for 2+ minutes', {
          timeSinceLastUpdate,
          lastUpdate: new Date(lastUpdateTime).toISOString(),
          sessionDuration: Math.round(sessionDuration / 1000 / 60) + ' minutes'
        });
        setIsHealthy(false);
        
        // Try to recover by refreshing the page after 5 minutes
        if (timeSinceLastUpdate > 300000) { // 5 minutes
          OverlayLogger.error('Overlay unhealthy for 5+ minutes, refreshing page');
          window.location.reload();
        }
      } else {
        setIsHealthy(true);
      }
    };
    
    const memoryCleanup = () => {
      // Force garbage collection if available (development only)
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && (window as unknown as { gc?: () => void }).gc) {
        try {
          (window as unknown as { gc: () => void }).gc();
        } catch {
          // Ignore GC errors
        }
      }
      
      // Log session duration every hour
      const sessionDuration = Date.now() - sessionStartTime;
      if (sessionDuration > 0 && sessionDuration % 3600000 < 30000) { // Every hour ± 30 seconds
        const memoryInfo = typeof performance !== 'undefined' && 
          'memory' in performance ? 
          (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory : null;
        
        OverlayLogger.overlay('Long-running session health check', {
          sessionDuration: Math.round(sessionDuration / 1000 / 60) + ' minutes',
          memoryUsage: memoryInfo ? {
            used: Math.round(memoryInfo.usedJSHeapSize / 1024 / 1024) + ' MB',
            total: Math.round(memoryInfo.totalJSHeapSize / 1024 / 1024) + ' MB',
            limit: Math.round(memoryInfo.jsHeapSizeLimit / 1024 / 1024) + ' MB'
          } : 'Not available'
        });
      }
    };
    
    // Health check every 30 seconds
    const healthInterval = setInterval(healthCheck, 30000);
    
    // Memory cleanup every 5 minutes
    const memoryInterval = setInterval(memoryCleanup, 300000);
    
    return () => {
      if (healthInterval) clearInterval(healthInterval);
      if (memoryInterval) clearInterval(memoryInterval);
    };
  }, [lastUpdateTime]);

  // Update lastUpdateTime whenever time updates
  useEffect(() => {
    setLastUpdateTime(Date.now());
  }, [time, date]);

  // Periodic location updates for IRL streaming - ensures location stays fresh
  useEffect(() => {
    const updateLocationPeriodically = async () => {
      const coords = lastCoords.current;
      if (!coords) return;

      const now = Date.now();
      const locationElapsed = now - lastLocationTime.current;
      
      // Only update if enough time has passed (respect rate limits)
      if (locationElapsed < 30000) return; // Minimum 30 seconds between updates

      OverlayLogger.overlay('Periodic location update triggered', {
        coords,
        lastUpdate: new Date(lastLocationTime.current).toISOString(),
        elapsed: locationElapsed
      });

      let loc: LocationData | null = null;
      
      // Try LocationIQ first (if rate limit allows)
      if (API_KEYS.LOCATIONIQ && canMakeApiCall('locationiq')) {
        trackApiCall('locationiq');
        loc = await safeApiCall(
          () => fetchLocationFromLocationIQ(coords[0], coords[1], API_KEYS.LOCATIONIQ!),
          'Periodic LocationIQ fetch'
        ) as LocationData | null;
      }
      
      // Fallback to Mapbox if LocationIQ failed or hit rate limit
      if (!loc && API_KEYS.MAPBOX && canMakeApiCall('mapbox')) {
        trackApiCall('mapbox');
        loc = await safeApiCall(
          () => fetchLocationFromMapbox(coords[0], coords[1], API_KEYS.MAPBOX!),
          'Periodic Mapbox fetch'
        ) as LocationData | null;
      }
      
      if (loc) {
        lastLocationTime.current = now;
        const formatted = formatLocation(loc, settingsRef.current.locationDisplay);
        setLocation({
          label: formatted.primary,
          context: formatted.context,
          countryCode: loc.countryCode || ''
        });
        OverlayLogger.overlay('Periodic location update successful', formatted);
      }
    };

    // Set up periodic location updates every 2 minutes
    periodicLocationTimer.current = setInterval(updateLocationPeriodically, 120000);

    return () => {
      if (periodicLocationTimer.current) {
        clearInterval(periodicLocationTimer.current);
        periodicLocationTimer.current = null;
      }
    };
  }, [safeApiCall, canMakeApiCall, trackApiCall]);

  // Debug panel for development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const debugInfo = {
        timezone,
        time,
        date,
        lastUpdate: new Date(lastUpdateTime).toISOString(),
        isHealthy,
        hasLocation: !!location,
        hasWeather: !!weather,
        hasMapCoords: !!mapCoords,
        overlayVisible,
        sseConnected: typeof window !== 'undefined' && 
          (window as unknown as { eventSource?: EventSource }).eventSource?.readyState === EventSource.OPEN
      };
      
      // Only log every 30 seconds to avoid spam
      if (Date.now() % 30000 < 1000) {
        OverlayLogger.overlay('Debug Info', debugInfo);
      }
    }
  }, [time, date, timezone, lastUpdateTime, isHealthy, location, weather, mapCoords, overlayVisible]);

  // Debug: Force refresh on page load (remove in production)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Only log once per session to reduce console noise
      if (!sessionStorage.getItem('tazo-overlay-debug-reset')) {
        OverlayLogger.overlay('Debug: Resetting location/weather timers for fresh data');
        sessionStorage.setItem('tazo-overlay-debug-reset', 'true');
      }
      lastWeatherTime.current = 0;
      lastLocationTime.current = 0;
    }
  }, []);
  
  // Debug: Manual refresh function (available for debugging)
  // const forceRefresh = () => {
  //   if (process.env.NODE_ENV === 'development') {
  //     OverlayLogger.overlay('Debug: Manual refresh triggered');
  //     lastWeatherTime.current = 0;
  //     lastLocationTime.current = 0;
  //     lastCoords.current = null;
  //     setWeather(null);
  //     setLocation(null);
  //   }
  // };

  // Refs
  const timeFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const timeUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const timeSyncTimeout = useRef<NodeJS.Timeout | null>(null);

  // Global error handling to prevent crashes
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      OverlayLogger.error('Unhandled error caught', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
      // Don't prevent default - let the error boundary handle it
    };
    
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      OverlayLogger.error('Unhandled promise rejection caught', {
        reason: event.reason,
        promise: event.promise
      });
      // Prevent the default behavior to avoid console errors
      event.preventDefault();
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Filter out RTIRL Firebase cookie warnings
  useEffect(() => {
    const originalWarn = console.warn;
    const filteredWarn = (...args: Parameters<typeof console.warn>) => {
      const message = args[0];
      if (typeof message === 'string' && message.includes('Cookie "" has been rejected as third-party')) {
        return;
      }
      originalWarn.apply(console, args);
    };
    
    console.warn = filteredWarn;
    return () => {
      console.warn = originalWarn;
    };
  }, []);

  // Create date/time formatters
  const createDateTimeFormatters = useCallback((timezone: string) => {
    timeFormatter.current = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    dateFormatter.current = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    });
  }, []);

  // Ensure we have a default timezone so UI renders quickly
  useEffect(() => {
    if (!timezone) {
      const tz = 'UTC';
      createDateTimeFormatters(tz);
      setTimezone(tz);
      // Timezone ready;
    }
  }, [timezone, createDateTimeFormatters]);

  // Time and date updates - aligned to minute boundary with drift correction
  useEffect(() => {
    if (!timezone || !timeFormatter.current || !dateFormatter.current) return;
    
    let isActive = true;
    let lastExpectedUpdate = 0;
    let driftCorrectionCount = 0;
    const MAX_DRIFT_CORRECTIONS = 10; // Prevent infinite drift corrections
    
    function updateTimeAndDate() {
      if (!isActive) return;
      
      try {
        const now = new Date();
        const timeParts = timeFormatter.current!.formatToParts(now);
        const timePart = timeParts.find(part => part.type === 'hour' || part.type === 'minute')?.value || '';
        const minutePart = timeParts.find(part => part.type === 'minute')?.value || '';
        const ampmPart = timeParts.find(part => part.type === 'dayPeriod')?.value || '';
        
        setTime(`${timePart}:${minutePart} ${ampmPart}`);
        setDate(dateFormatter.current!.format(now));
        
        // Drift correction: check if we're significantly off schedule
        const currentTime = now.getTime();
        const expectedTime = lastExpectedUpdate + 60000; // Expected next update time
        const drift = Math.abs(currentTime - expectedTime);
        
        // If we're more than 5 seconds off, resync to the next minute boundary
        if (lastExpectedUpdate > 0 && drift > 5000 && driftCorrectionCount < MAX_DRIFT_CORRECTIONS) {
          OverlayLogger.warn('Time drift detected, resyncing to minute boundary', {
            drift: drift,
            expectedTime: new Date(expectedTime).toISOString(),
            actualTime: now.toISOString()
          });
          
          driftCorrectionCount++;
          resyncToMinuteBoundary();
          return;
        }
        
        lastExpectedUpdate = currentTime;
      } catch (error) {
        OverlayLogger.error('Time update failed', error);
        // Fallback to basic time display
        const now = new Date();
        setTime(now.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true,
          timeZone: timezone || 'UTC'
        }));
        setDate(now.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          timeZone: timezone || 'UTC'
        }));
      }
    }
    
    function resyncToMinuteBoundary() {
      // Clear existing timers
      if (timeUpdateTimer.current) {
        clearInterval(timeUpdateTimer.current);
        timeUpdateTimer.current = null;
      }
      if (timeSyncTimeout.current) {
        clearTimeout(timeSyncTimeout.current);
        timeSyncTimeout.current = null;
      }
      
      // Calculate delay until the next exact minute boundary
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
      // Schedule sync to next minute boundary
      timeSyncTimeout.current = setTimeout(() => {
        if (!isActive) return;
        
        updateTimeAndDate();
        lastExpectedUpdate = Date.now();
        
        // Start regular interval from this exact boundary
        timeUpdateTimer.current = setInterval(updateTimeAndDate, 60000);
      }, Math.max(0, msUntilNextMinute));
    }
    
    // Immediate update so UI isn't blank
    updateTimeAndDate();
    lastExpectedUpdate = Date.now();
    
    // Clear any existing timers before setting new ones
    if (timeUpdateTimer.current) {
      clearInterval(timeUpdateTimer.current);
      timeUpdateTimer.current = null;
    }
    if (timeSyncTimeout.current) {
      clearTimeout(timeSyncTimeout.current);
      timeSyncTimeout.current = null;
    }

    // Initial sync to minute boundary
    resyncToMinuteBoundary();
    
    return () => {
      isActive = false;
      if (timeSyncTimeout.current) {
        clearTimeout(timeSyncTimeout.current);
        timeSyncTimeout.current = null;
      }
      if (timeUpdateTimer.current) {
        clearInterval(timeUpdateTimer.current);
        timeUpdateTimer.current = null;
      }
    };
  }, [timezone]);

  // Load settings and set up real-time updates
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Add cache busting and force fresh data
        const timestamp = Date.now();
        const res = await fetch(`/api/get-settings?_t=${timestamp}`, { 
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        if (data) {
          setSettings(data);
          OverlayLogger.settings('Settings loaded', data);
        } else {
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        }
      } catch (error) {
        OverlayLogger.error('Failed to load settings, using defaults:', error);
        setSettings(DEFAULT_OVERLAY_SETTINGS);
      }
    };
    
    // Set up Server-Sent Events for real-time updates
    const setupSSE = () => {
      const eventSource = new EventSource('/api/settings-stream');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'settings_update') {
            OverlayLogger.settings('Settings updated via SSE', data);
            setSettings(data);
          } else if (data.type === 'connected') {
            OverlayLogger.settings('SSE connected', { timestamp: data.timestamp });
          } else if (data.type === 'heartbeat') {
            // Heartbeat received, connection is alive
            OverlayLogger.settings('SSE heartbeat', { timestamp: data.timestamp });
          }
      } catch (error) {
          OverlayLogger.error('Failed to parse SSE message', error);
        }
      };
      
      eventSource.onerror = (error) => {
        OverlayLogger.error('SSE connection error', error);
        // Close the current connection before reconnecting
        try {
          eventSource.close();
        } catch {
          // Ignore close errors
        }
        // Reconnect with exponential backoff and max retry limit
        const reconnectDelay = Math.min(1000 * Math.pow(2, 0), 10000); // Start with 1s, max 10s
        setTimeout(() => {
          try {
            OverlayLogger.settings('Reconnecting SSE...');
            setupSSE();
          } catch (error) {
            OverlayLogger.error('Failed to reconnect SSE', error);
          }
        }, reconnectDelay);
      };
      
      return eventSource;
    };
    
    // Load initial settings
    loadSettings();
    
    // Set up real-time updates
    const eventSource = setupSSE();
    
    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  // RTIRL connection - use refs to avoid re-running on timezone changes
  const timezoneRef = useRef(timezone);
  const createDateTimeFormattersRef = useRef(createDateTimeFormatters);
  
  // Update refs when values change
  useEffect(() => {
    timezoneRef.current = timezone;
  }, [timezone]);
  
  useEffect(() => {
    createDateTimeFormattersRef.current = createDateTimeFormatters;
  }, [createDateTimeFormatters]);

  // RTIRL connection
  useEffect(() => {
    let listenerSetup = false;
    
    const setupRTIRLListener = () => {
      if (listenerSetup) {
        OverlayLogger.overlay('RTIRL listener already set up, skipping');
        return;
      }
      
      OverlayLogger.overlay('setupRTIRLListener called', { 
        hasWindow: typeof window !== 'undefined',
        hasRealtimeIRL: typeof window !== 'undefined' && !!window.RealtimeIRL,
        hasAPIKey: !!API_KEYS.RTIRL
      });
      
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        OverlayLogger.overlay('Setting up RTIRL listener with key:', { key: API_KEYS.RTIRL.substring(0, 8) + '...' });
        listenerSetup = true;
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          try {
            if (process.env.NODE_ENV === 'development') {
              OverlayLogger.overlay('RTIRL raw payload received', { payload: p, type: typeof p });
            }
            if (!p || typeof p !== 'object') {
              OverlayLogger.warn('RTIRL received invalid payload', { payload: p });
              return;
            }
            const payload = p as RTIRLPayload;
          
          // Handle timezone from RTIRL
          if (payload.location?.timezone && payload.location.timezone !== timezoneRef.current) {
            try {
              createDateTimeFormattersRef.current(payload.location.timezone);
              setTimezone(payload.location.timezone);
              // Timezone ready;
              OverlayLogger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
            } catch (error) {
              OverlayLogger.error('Failed to set timezone from RTIRL', error);
              // Timezone ready;
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
          
          if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            if (process.env.NODE_ENV === 'development') {
              OverlayLogger.overlay('RTIRL GPS data received', { lat, lon });
            }
            setMapCoords([lat, lon]);
            
            // Calculate speed for minimap
            const now = Date.now();
            const prevCoords = lastCoords.current;
            const prevTime = lastCoordsTime.current;
            let speedKmh = 0;
            
            if (prevCoords && prevTime > 0) {
              const movedMeters = distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]);
              const timeDiffHours = (now - prevTime) / (1000 * 60 * 60);
              if (timeDiffHours > 0) {
                speedKmh = (movedMeters / 1000) / timeDiffHours;
              }
            }
            
            setCurrentSpeed(Math.round(speedKmh));
            
            lastCoords.current = [lat!, lon!];
            lastCoordsTime.current = now;
            
            // Kick off location + weather fetches on coordinate updates with gating
            (async () => {
              const movedMeters = prevCoords ? distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]) : Infinity;

              // WEATHER: fetch immediately on first fix or large move; else respect interval
              const weatherElapsed = now - lastWeatherTime.current;
              const largeMove = movedMeters >= THRESHOLDS.WEATHER_DISTANCE_KM * 1000;
              const shouldFetchWeather = lastWeatherTime.current === 0 || largeMove || weatherElapsed >= TIMERS.WEATHER_TIMEZONE_UPDATE;
              
              if (shouldFetchWeather) {
                const weatherResult = await safeApiCall(
                  () => fetchWeatherAndTimezoneFromOpenMeteo(lat!, lon!),
                  'Weather fetch'
                );
                
                lastWeatherTime.current = Date.now();
                if (weatherResult && typeof weatherResult === 'object' && 'weather' in weatherResult) {
                  const result = weatherResult as { weather?: { temp: number; desc: string }; timezone?: string };
                  if (result.weather) {
                    setWeather(result.weather);
                  } else {
                    setWeather(null);
                  }
                  if (result.timezone && result.timezone !== timezone) {
                    createDateTimeFormatters(result.timezone);
                    setTimezone(result.timezone);
                  }
                } else {
                  setWeather(null);
                }
              }

              const locationElapsed = now - lastLocationTime.current;
              const isStationary = movedMeters < 100;
              const isMoving = speedKmh >= THRESHOLDS.MOVING_THRESHOLD;
              const isHighSpeed = speedKmh >= THRESHOLDS.HIGH_SPEED_MOVEMENT;
              
              // Get current location data to determine granularity-based thresholds
              const currentLocationData = location ? {
                neighbourhood: location.context?.includes('neighbourhood') ? location.context : undefined,
                suburb: location.context?.includes('suburb') ? location.context : undefined,
                town: location.context?.includes('town') ? location.context : undefined,
                city: location.label,
                state: location.context?.includes('state') ? location.context : undefined,
                country: location.countryCode
              } as LocationData : null;
              
              const thresholds = getLocationUpdateThresholds(currentLocationData);
              
              // Dynamic timing based on speed and granularity for IRL streaming
              let minTimeBetweenCalls: number;
              if (isHighSpeed) {
                minTimeBetweenCalls = Math.min(thresholds.timeThreshold, 30000); // Cap at 30s for high speed
              } else if (isMoving) {
                minTimeBetweenCalls = Math.min(thresholds.timeThreshold, 120000); // Cap at 2min for normal movement
              } else {
                minTimeBetweenCalls = thresholds.timeThreshold; // Use full threshold when stationary
              }
              
              const meetsDistance = movedMeters >= thresholds.distanceThreshold;
              const shouldFetchLocation = lastLocationTime.current === 0 || 
                (locationElapsed >= minTimeBetweenCalls && meetsDistance) ||
                (locationElapsed >= minTimeBetweenCalls * 2); // Fallback: update even without distance if enough time passed
              
              // Debug location caching
              if (process.env.NODE_ENV === 'development') {
                OverlayLogger.overlay('Location fetch decision', {
                  movedMeters,
                  isStationary,
                  isMoving,
                  isHighSpeed,
                  locationElapsed,
                  minTimeBetweenCalls,
                  meetsDistance,
                  shouldFetchLocation,
                  granularity: thresholds.granularity,
                  distanceThreshold: thresholds.distanceThreshold,
                  timeThreshold: thresholds.timeThreshold,
                  lastLocationTime: lastLocationTime.current,
                  locationIqCalls: locationIqCalls.current,
                  mapboxCalls: mapboxCalls.current
                });
              }

              if (shouldFetchLocation) {
                let loc: LocationData | null = null;
                
                // Try LocationIQ first (if rate limit allows)
                if (API_KEYS.LOCATIONIQ && canMakeApiCall('locationiq')) {
                  trackApiCall('locationiq');
                  const locationResult = await safeApiCall(
                    () => fetchLocationFromLocationIQ(lat!, lon!, API_KEYS.LOCATIONIQ!),
                    'LocationIQ fetch'
                  );
                  if (locationResult && typeof locationResult === 'object') {
                    loc = locationResult as LocationData;
                  }
                }
                
                // Fallback to Mapbox if LocationIQ failed or hit rate limit
                if (!loc && API_KEYS.MAPBOX && canMakeApiCall('mapbox')) {
                  trackApiCall('mapbox');
                  const mapboxResult = await safeApiCall(
                    () => fetchLocationFromMapbox(lat!, lon!, API_KEYS.MAPBOX!),
                    'Mapbox fetch'
                  );
                  if (mapboxResult && typeof mapboxResult === 'object') {
                    loc = mapboxResult as LocationData;
                  }
                }
                
                lastLocationTime.current = Date.now();
                if (loc) {
                  const formatted = formatLocation(loc, settingsRef.current.locationDisplay);
                  setLocation({
                    label: formatted.primary,
                    context: formatted.context,
                    countryCode: loc.countryCode || ''
                  });
                  
                  OverlayLogger.overlay('Location updated', {
                    granularity: thresholds.granularity,
                    location: formatted,
                    apiCalls: {
                      locationIq: locationIqCalls.current,
                      mapbox: mapboxCalls.current
                    }
                  });
                } else {
                  OverlayLogger.warn('Location fetch failed - both APIs unavailable or rate limited', {
                    locationIqAvailable: canMakeApiCall('locationiq'),
                    mapboxAvailable: canMakeApiCall('mapbox'),
                    apiCalls: {
                      locationIq: locationIqCalls.current,
                      mapbox: mapboxCalls.current
                    }
                  });
                }
              }
            })();
    } else {
            OverlayLogger.warn('RTIRL GPS data invalid');
          }
          } catch (error) {
            OverlayLogger.error('RTIRL listener error', error);
            // Don't break the entire component on RTIRL errors
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
    
    // Check if RTIRL is already loaded
    if (typeof window !== 'undefined' && window.RealtimeIRL) {
      setupRTIRLListener();
    } else {
      // Load RTIRL script if not already loaded
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
      script.async = true;
      script.onerror = () => {
        OverlayLogger.error('Failed to load RTIRL script');
      };
      script.onload = () => {
        if (process.env.NODE_ENV === 'development') {
          OverlayLogger.overlay('RTIRL script loaded, setting up listener...');
        }
        setupRTIRLListener();
      };
      document.body.appendChild(script);
    }

    return () => {
      // RTIRL script cleanup handled automatically
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No dependencies - use refs instead to prevent duplicate listeners

  // Overlay visibility with fade-in delay
  const isOverlayReady = useMemo(() => timezone && time && date, [timezone, time, date]);

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      // Wait 1.5 seconds for all components to load, then fade in
      const delay = setTimeout(() => setOverlayVisible(true), 1500);
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);

  // Trigger location update when overlay becomes visible for IRL streaming
  useEffect(() => {
    if (overlayVisible && lastCoords.current) {
      const now = Date.now();
      const locationElapsed = now - lastLocationTime.current;
      
      // If location is stale (older than 5 minutes), trigger immediate update
      if (locationElapsed > 300000) {
        OverlayLogger.overlay('Overlay visible - triggering fresh location update', {
          coords: lastCoords.current,
          lastUpdate: new Date(lastLocationTime.current).toISOString(),
          elapsed: locationElapsed
        });
        
        // Trigger location update asynchronously
        (async () => {
          const coords = lastCoords.current!;
          let loc: LocationData | null = null;
          
          if (API_KEYS.LOCATIONIQ && canMakeApiCall('locationiq')) {
            trackApiCall('locationiq');
            loc = await safeApiCall(
              () => fetchLocationFromLocationIQ(coords[0], coords[1], API_KEYS.LOCATIONIQ!),
              'Visibility LocationIQ fetch'
            ) as LocationData | null;
          }
          
          if (!loc && API_KEYS.MAPBOX && canMakeApiCall('mapbox')) {
            trackApiCall('mapbox');
            loc = await safeApiCall(
              () => fetchLocationFromMapbox(coords[0], coords[1], API_KEYS.MAPBOX!),
              'Visibility Mapbox fetch'
            ) as LocationData | null;
          }
          
          if (loc) {
            lastLocationTime.current = now;
            const formatted = formatLocation(loc, settingsRef.current.locationDisplay);
            setLocation({
              label: formatted.primary,
              context: formatted.context,
              countryCode: loc.countryCode || ''
            });
          }
        })();
      }
    }
  }, [overlayVisible, safeApiCall, canMakeApiCall, trackApiCall]);

  // Memoized display values
  const locationDisplay = useMemo(() => {
    OverlayLogger.overlay('Location display calculation', {
      locationDisplay: settings.locationDisplay,
      hasLocation: !!location,
      location: location,
      customLocation: settings.customLocation
    });
    
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      if (!settings.customLocation || settings.customLocation.trim() === '') {
        return null;
      }
      return {
        primary: settings.customLocation.trim(),
        context: undefined,
        countryCode: location?.countryCode || null,
        countryName: location?.countryCode || null
      };
    }
    
    if (!location || !location.label) {
      return null;
    }
    
    return {
      primary: location.label,
      context: location.context,
      countryCode: location.countryCode,
      countryName: location.countryCode || 'Unknown'
    };
  }, [location, settings.locationDisplay, settings.customLocation]);

  const weatherDisplay = useMemo(() => {
    if (!weather) {
      return null;
    }
    
    return {
      description: weather.desc.toUpperCase(),
      temperature: `${weather.temp}°C / ${celsiusToFahrenheit(weather.temp)}°F`
    };
  }, [weather]);

  return (
    <ErrorBoundary>
      <div 
        id="overlay" 
        className={overlayVisible ? 'show' : ''}
        style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.8s ease-in-out'
        }}
      >
        <div className="top-left">
          <div className="overlay-container">
            {timezone && time && (
              <div className="time time-left">
                <div className="time-display">
                  <span className="time-value">{time.split(' ')[0]}</span>
                  <span className="time-period">{time.split(' ')[1]}</span>
                </div>
              </div>
            )}
            
            {timezone && date && (
              <div className="date date-left">
                {date}
              </div>
            )}
            
            {API_KEYS.PULSOID && (
              <HeartRateMonitor 
                pulsoidToken={API_KEYS.PULSOID} 
              />
            )}
          </div>
        </div>

        <div className="top-right">
          <div className="overlay-container">
            {locationDisplay && (
              <div className="location">
                <div className="location-text">
                  <div className="location-main">{locationDisplay.primary}</div>
                  {locationDisplay.context && (
                    <div className="location-sub">{locationDisplay.context}</div>
                  )}
                </div>
              </div>
            )}
            
            {weatherDisplay && (
            <div className="weather">
                <div className="weather-container">
                  <div className="weather-content">
                    <div className="weather-description">
                      {weatherDisplay.description}
                    </div>
                    <div className="weather-temperature">
                      {weatherDisplay.temperature}
                    </div>
                  </div>
                  {locationDisplay?.countryCode && (
                    <div className="weather-flag-container">
                      <img
                        src={`https://flagcdn.com/${locationDisplay.countryCode}.svg`}
                        alt={`Country: ${locationDisplay.countryName}`}
                        width={32}
                        height={20}
                        className="weather-flag"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {mapCoords && (settings.showMinimap || (settings.minimapSpeedBased && currentSpeed > 0)) && (
              <div className="minimap">
                <MapboxMinimap 
                  lat={mapCoords[0]} 
                  lon={mapCoords[1]} 
                  isVisible={overlayVisible}
                  speedKmh={currentSpeed}
                />
                </div>
              )}
            </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
