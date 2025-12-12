"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit } from '@/utils/unit-conversions';
import { API_KEYS, TIMERS, type RTIRLPayload } from '@/utils/overlay-constants';

// Extract constants for cleaner code
const {
  GPS_FRESHNESS_TIMEOUT,
  GPS_STALE_TIMEOUT,
  WEATHER_DATA_VALIDITY_TIMEOUT,
  LOCATION_DATA_VALIDITY_TIMEOUT,
  MINIMAP_FADE_DURATION,
  WALKING_PACE_THRESHOLD,
  SETTINGS_POLLING_INTERVAL,
  MINIMAP_STALENESS_CHECK_INTERVAL,
  MINIMAP_SPEED_GRACE_PERIOD,
  MINIMAP_GPS_STALE_GRACE_PERIOD,
} = TIMERS;
import { distanceInMeters } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ, type SunriseSunsetData } from '@/utils/api-utils';
import { formatLocation, formatCountryName, type LocationData } from '@/utils/location-utils';
import { checkRateLimit } from '@/utils/rate-limiting';
import { 
  createLocationWithCountryFallback, 
  createWeatherFallback, 
  createSunriseSunsetFallback,
  isNightTimeFallback
} from '@/utils/fallback-utils';

declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

// MapLibreMinimap component - WebGL-based map rendering
const MapLibreMinimap = dynamic(() => import('@/components/MapLibreMinimap'), {
  ssr: false,
  loading: () => <div className="minimap-placeholder" />
});

const HeartRateMonitor = dynamic(() => import('@/components/HeartRateMonitor'), {
  ssr: false,
  loading: () => null
});

// Flag component to reduce duplication
const LocationFlag = ({ countryCode, flagLoaded, getEmojiFlag }: { 
  countryCode: string; 
  flagLoaded: boolean; 
  getEmojiFlag: (code: string) => string;
}) => (
  <span className="location-flag-inline">
    {flagLoaded ? (
      <img
                        src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
                        alt={`Country: ${countryCode}`}
                        width={32}
                        height={20}
                        className="location-flag-small"
      />
    ) : (
      <span 
        className="location-flag-emoji-small"
        style={{ fontSize: '16px', lineHeight: '16px' }}
        title={`Country: ${countryCode}`}
      >
        {getEmojiFlag(countryCode)}
      </span>
    )}
  </span>
);

function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // State
  const [timeDisplay, setTimeDisplay] = useState({ time: '', date: '' });
  const [location, setLocation] = useState<{ 
    primary: string; 
    country?: string;
    countryCode?: string;
  } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sunriseSunset, setSunriseSunset] = useState<SunriseSunsetData | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [flagLoaded, setFlagLoaded] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [minimapOpacity, setMinimapOpacity] = useState(0.95); // Track opacity for fade transitions
  const [hasReceivedFreshGps, setHasReceivedFreshGps] = useState(false); // Track if we've received at least one fresh GPS update
  const [hasIncompleteLocationData, setHasIncompleteLocationData] = useState(false); // Track if we have incomplete location data (country but no code)
  const [overlayVisible, setOverlayVisible] = useState(false); // Track if overlay should be visible (fade-in delay)
  
  // Todo completion tracking with localStorage persistence
  const [completedTodoTimestamps, setCompletedTodoTimestamps] = useState<Map<string, number>>(new Map()); // Track when todos were completed
  const completedTodoTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map()); // Track timers for hiding completed todos
  const STORAGE_KEY = 'tazo-completed-todos'; // localStorage key for persistence
  

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastGpsUpdateTime = useRef(0); // Track when we last got GPS data (use ref for synchronous updates)
  const lastGpsTimestamp = useRef(0); // Track the actual GPS timestamp from payload (not reception time)
  const weatherFetchInProgress = useRef(false); // Track if weather fetch is already in progress
  const locationFetchInProgress = useRef(false); // Track if location fetch is already in progress
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const lastSettingsHash = useRef<string>('');
  const lastRawLocation = useRef<LocationData | null>(null);
  const lastSuccessfulWeatherFetch = useRef(0); // Track when weather was last successfully fetched
  const lastSuccessfulLocationFetch = useRef(0); // Track when location was last successfully fetched
  
  // API rate limiting tracking (per-second only)
  // GPS update tracking for minimap
  const minimapFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speedBelowThresholdSinceRef = useRef<number | null>(null); // Track when speed dropped below threshold
  const gpsStaleSinceRef = useRef<number | null>(null); // Track when GPS became stale
  
  // GPS freshness tracking for location/weather display
  const locationWeatherHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Helper: Check if GPS update is fresh (within 15 minutes)
  const isGpsUpdateFresh = (gpsUpdateTime: number, now: number, _isFirstUpdate?: boolean): boolean => {
    return (now - gpsUpdateTime) <= GPS_FRESHNESS_TIMEOUT;
  };
  
  // Helper: Check if timezone is real (not UTC placeholder)
  const isRealTimezone = (tz: string | null): boolean => tz !== null && tz !== 'UTC';
  
  // Helper: Clear timeout safely
  const clearTimer = (timerRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  
  // Safe API call wrapper
  const safeApiCall = async (apiCall: () => Promise<unknown>, context: string): Promise<unknown> => {
    try {
      return await apiCall();
    } catch (error) {
      OverlayLogger.error(`${context} failed`, error);
      return null;
    }
  };

  // Ref to track current speed for minimap visibility (prevents infinite loops)
  const currentSpeedRef = useRef(0);
  
  // Update ref when speed changes
  useEffect(() => {
    currentSpeedRef.current = currentSpeed;
  }, [currentSpeed]);

  // Helper to mark GPS as received
  const markGpsReceived = useCallback(() => {
    setHasReceivedFreshGps(true);
  }, []);

  // Helper to mark GPS as stale
  const markGpsStale = useCallback(() => {
    setHasReceivedFreshGps(false);
  }, []);

  // Minimap visibility logic: Show when speed > 5 km/h and GPS fresh, hide when GPS stale
  // Uses speed from RTIRL or calculated from coordinate changes
  const updateMinimapVisibility = useCallback(() => {
    const now = Date.now();
    const timeSinceLastGps = lastGpsUpdateTime.current > 0 ? (now - lastGpsUpdateTime.current) : Infinity;
    const isGpsStale = timeSinceLastGps > GPS_STALE_TIMEOUT;
    
    clearTimer(minimapFadeTimeoutRef);
    
    // Use ref to avoid dependency on currentSpeed state (prevents infinite loops)
    const speed = currentSpeedRef.current;
    
    if (settings.minimapSpeedBased) {
      if (isGpsStale) {
        // GPS stale - track when it became stale and check grace period
        if (gpsStaleSinceRef.current === null) {
          gpsStaleSinceRef.current = now; // Mark when GPS became stale
        }
        
        const timeSinceStale = now - gpsStaleSinceRef.current;
        if (timeSinceStale >= MINIMAP_GPS_STALE_GRACE_PERIOD) {
          // Grace period elapsed - hide minimap
          if (minimapVisible) {
            setMinimapOpacity(0);
            minimapFadeTimeoutRef.current = setTimeout(() => setMinimapVisible(false), MINIMAP_FADE_DURATION);
          }
          // Only update speed state if it's actually > 0 (prevents unnecessary re-renders)
          if (speed > 0) {
            setCurrentSpeed(0);
          }
        }
        // If still in grace period, keep minimap visible
      } else {
        // GPS is fresh - clear stale tracking
        gpsStaleSinceRef.current = null;
        
        if (speed > WALKING_PACE_THRESHOLD) {
          // Speed > 5 km/h and GPS fresh - show minimap
          speedBelowThresholdSinceRef.current = null; // Clear speed grace period tracking
          if (!minimapVisible) {
            setMinimapVisible(true);
          }
          setMinimapOpacity(0.95);
        } else if (minimapVisible) {
          // Speed <= 5 km/h - track when it dropped below threshold
          if (speedBelowThresholdSinceRef.current === null) {
            speedBelowThresholdSinceRef.current = now;
          }
          
          const timeSinceBelowThreshold = now - speedBelowThresholdSinceRef.current;
          if (timeSinceBelowThreshold >= MINIMAP_SPEED_GRACE_PERIOD) {
            // Grace period elapsed - hide minimap
            setMinimapOpacity(0);
            minimapFadeTimeoutRef.current = setTimeout(() => setMinimapVisible(false), MINIMAP_FADE_DURATION);
          }
          // If still in grace period, keep minimap visible
        }
      }
    } else if (settings.showMinimap) {
      // Manual show mode
      if (!minimapVisible) {
        setMinimapVisible(true);
        setMinimapOpacity(0);
        requestAnimationFrame(() => setMinimapOpacity(0.95));
      } else {
        setMinimapOpacity(0.95);
      }
    } else {
      // Manual hide mode (showMinimap is false and minimapSpeedBased is false)
      // Hide immediately when manually turned off (no fade delay)
      if (minimapVisible) {
        setMinimapVisible(false);
        setMinimapOpacity(0);
        // Clear any pending fade timeout
        clearTimer(minimapFadeTimeoutRef);
      }
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, minimapVisible]);

  // Update settings hash and re-format location whenever settings change
  useEffect(() => {
    const newHash = JSON.stringify(settings);
    const hashChanged = newHash !== lastSettingsHash.current;
    lastSettingsHash.current = newHash;

    // Re-render location display instantly from cached raw data if available
    // This ensures location display updates immediately when settings change
    // IMPORTANT: Only re-format if we have complete location data (not just country)
    // This prevents trying to format incomplete fallback data
    const hasCompleteLocationData = lastRawLocation.current && (
      lastRawLocation.current.city || 
      lastRawLocation.current.town || 
      lastRawLocation.current.village || 
      lastRawLocation.current.municipality ||
      lastRawLocation.current.neighbourhood || 
      lastRawLocation.current.suburb || 
      lastRawLocation.current.district
    );
    
    if (hasCompleteLocationData && settings.locationDisplay !== 'hidden') {
      try {
        const formatted = formatLocation(lastRawLocation.current!, settings.locationDisplay);
        // Always update location state when settings change, even if formatted result is empty
        // This ensures the display mode change is reflected immediately
        if (hashChanged) {
          OverlayLogger.location('Location display mode changed', {
            mode: settings.locationDisplay,
            primary: formatted.primary || 'none',
            secondary: formatted.country || 'none', // Secondary line (city/state/country)
            rawLocation: {
              city: lastRawLocation.current!.city,
              neighbourhood: lastRawLocation.current!.neighbourhood,
              suburb: lastRawLocation.current!.suburb
            }
          });
        }
        setLocation({
          primary: formatted.primary || '',
          country: formatted.country,
          countryCode: lastRawLocation.current!.countryCode || ''
        });
        setHasIncompleteLocationData(false); // Clear incomplete flag when re-formatting
      } catch (error) {
        OverlayLogger.warn('Location re-formatting failed on settings change', { error });
        // Ignore formatting errors; UI will update on next normal cycle
      }
    } else if (hashChanged && !hasCompleteLocationData) {
      // Log when settings change but we don't have complete location data yet
      // Only log if we actually have raw location data but it's incomplete (helps debug formatting issues)
      if (lastRawLocation.current) {
        OverlayLogger.location('Settings changed but no complete location data available yet', {
          mode: settings.locationDisplay,
          hasRawLocation: true,
          willUpdateOnNextFetch: true
        });
      }
    }
  }, [settings]);

  // Update minimap visibility when relevant state changes
  useEffect(() => {
    try {
      // Clear grace period refs when switching modes or disabling minimap
      if (!settings.minimapSpeedBased) {
        speedBelowThresholdSinceRef.current = null;
        gpsStaleSinceRef.current = null;
      }
      updateMinimapVisibility();
    } catch (error) {
      OverlayLogger.error('Failed to update minimap visibility in effect', error);
      // Don't throw - allow overlay to continue functioning
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, updateMinimapVisibility]);

  // Update minimap visibility when speed changes (speed-based mode only)
  useEffect(() => {
    if (settings.minimapSpeedBased) {
      try {
        updateMinimapVisibility();
      } catch (error) {
        OverlayLogger.error('Failed to update minimap visibility on speed change', error);
        // Don't throw - allow overlay to continue functioning
      }
    }
  }, [currentSpeed, settings.minimapSpeedBased, updateMinimapVisibility]);

  // Periodic check for GPS staleness to auto-hide minimap when GPS stops updating
  useEffect(() => {
    if (!settings.minimapSpeedBased) {
      return; // Only check if speed-based mode is enabled
    }

    const stalenessCheckInterval = setInterval(() => {
      try {
        updateMinimapVisibility();
      } catch (error) {
        OverlayLogger.error('Failed to update minimap visibility in staleness check', error);
        // Don't throw - allow overlay to continue functioning
      }
    }, MINIMAP_STALENESS_CHECK_INTERVAL);

    return () => {
      clearInterval(stalenessCheckInterval);
    };
  }, [settings.minimapSpeedBased, updateMinimapVisibility]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimer(minimapFadeTimeoutRef);
      clearTimer(locationWeatherHideTimeoutRef);
      // Cleanup completed todo timers
      completedTodoTimersRef.current.forEach((timer) => clearTimeout(timer));
      completedTodoTimersRef.current.clear();
    };
  }, []);

  // Get emoji flag for country code (fast fallback)
  const getEmojiFlag = (countryCode: string): string => {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };



  // Rate limiting is handled by checkRateLimit() from rate-limiting.ts
  // This ensures both per-second (1/sec) and daily (5,000/day) limits are enforced




  

  // Refs
  const timeFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const timeUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const timeSyncTimeout = useRef<NodeJS.Timeout | null>(null);

  // Global error handling - suppress harmless errors, log others
  useEffect(() => {
    const isHarmlessChromeError = (message: string | undefined, source?: string): boolean => {
      if (!message) return false;
      return message.includes('chrome is not defined') || 
             (message.includes('chrome') && (source?.includes('rtirl') ?? false));
    };
    
    const handleError = (event: ErrorEvent) => {
      if (isHarmlessChromeError(event.message, event.filename)) {
        event.preventDefault();
        return;
      }
      OverlayLogger.error('Unhandled error', {
        message: event.message,
        filename: event.filename
      });
    };
    
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.toString() || '';
      if (isHarmlessChromeError(reason)) {
        event.preventDefault();
        return;
      }
      OverlayLogger.error('Unhandled promise rejection', { reason: event.reason });
      event.preventDefault();
    };
    
    const originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      if (typeof message === 'string' && isHarmlessChromeError(message, source || undefined)) {
        return true;
      }
      return originalOnError ? originalOnError(message, source, lineno, colno, error) : false;
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.onerror = originalOnError;
    };
  }, []);


  // Create date/time formatters
  const createDateTimeFormatters = useCallback((timezone: string) => {
    try {
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
      
      // DateTime formatters created - time will update via useEffect when timezone is set
    } catch (error) {
      OverlayLogger.warn('Invalid timezone format, using UTC fallback', { timezone, error });
      // Fallback to UTC
      timeFormatter.current = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'UTC',
      });
      dateFormatter.current = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
  }, []);

  // Don't set UTC as default - wait for real timezone from API
  // This prevents showing wrong time initially
  
  // Helper to set timezone and create formatters (often called together)
  const setTimezoneAndFormatters = useCallback((newTimezone: string) => {
    createDateTimeFormatters(newTimezone);
    setTimezone(newTimezone);
  }, [createDateTimeFormatters]);

  // Helper functions to update data and mark GPS as received (consolidates repeated patterns)
  const updateLocation = useCallback((locationData: { primary: string; country?: string; countryCode?: string }) => {
    setLocation(locationData);
    lastSuccessfulLocationFetch.current = Date.now();
    markGpsReceived();
  }, [markGpsReceived]);

  const updateWeather = useCallback((weatherData: { temp: number; desc: string }) => {
    setWeather(weatherData);
    lastSuccessfulWeatherFetch.current = Date.now();
    markGpsReceived();
  }, [markGpsReceived]);

  const updateTimezone = useCallback((timezoneData: string) => {
    setTimezoneAndFormatters(timezoneData);
    markGpsReceived();
  }, [markGpsReceived, setTimezoneAndFormatters]);

  // Extract GPS coordinates from RTIRL payload
  const extractCoordinates = useCallback((payload: RTIRLPayload): [number, number] | null => {
    if (!payload.location) return null;
    
    let lat: number | null = null;
    let lon: number | null = null;
    
    if ('lat' in payload.location && 'lon' in payload.location) {
      lat = payload.location.lat;
      lon = payload.location.lon;
    } else if ('latitude' in payload.location && 'longitude' in payload.location) {
      lat = (payload.location as { latitude: number }).latitude;
      lon = (payload.location as { longitude: number }).longitude;
    }
    
    if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return [lat, lon];
    }
    
    return null;
  }, []);

  // Extract GPS timestamp from RTIRL payload
  const extractGpsTimestamp = useCallback((payload: RTIRLPayload): number => {
    const payloadWithTimestamp = payload as RTIRLPayload & { 
      timestamp?: number; 
      time?: number;
      reportedAt?: number;
      updatedAt?: number;
    };
    
    const payloadTimestamp = payloadWithTimestamp.reportedAt || 
                            payloadWithTimestamp.updatedAt || 
                            payloadWithTimestamp.timestamp || 
                            payloadWithTimestamp.time;
    
    return payloadTimestamp && typeof payloadTimestamp === 'number' 
      ? payloadTimestamp 
      : Date.now();
  }, []);

  // Calculate speed from RTIRL payload and coordinates
  const calculateSpeed = useCallback((
    payload: RTIRLPayload,
    lat: number,
    lon: number,
    prevCoords: [number, number] | null,
    prevGpsTimestamp: number,
    gpsUpdateTime: number,
    wasGpsDataStale: boolean
  ): number => {
    if (wasGpsDataStale) return 0;
    
    // Try RTIRL speed first (preferred source)
    if (typeof payload === 'object' && payload !== null && 'speed' in payload) {
      const rawSpeedValue = (payload as RTIRLPayload).speed;
      if (typeof rawSpeedValue === 'number' && rawSpeedValue >= 0) {
        return rawSpeedValue;
      }
    }
    
    // Calculate from coordinates as fallback
    if (!prevCoords || prevGpsTimestamp <= 0) return 0;
    
    const movedMeters = distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]);
    const timeDiffSeconds = (gpsUpdateTime - prevGpsTimestamp) / 1000;
    const timeDiffHours = timeDiffSeconds / 3600;
    const MIN_TIME_SECONDS = 0.5;
    
    if (timeDiffHours > 0 && timeDiffSeconds >= MIN_TIME_SECONDS && movedMeters > 0) {
      return (movedMeters / 1000) / timeDiffHours;
    } else if (movedMeters === 0 && timeDiffSeconds > 0) {
      return 0;
    }
    
    return 0;
  }, []);
  
  // Update time display immediately when formatters are created and timezone is set
  useEffect(() => {
    // isRealTimezone is a pure function, no need to include in deps
    if (!isRealTimezone(timezone) || !timeFormatter.current || !dateFormatter.current) return;
    
    // Immediately update time display when formatters are ready
    const now = new Date();
    setTimeDisplay({
      time: timeFormatter.current.format(now),
      date: dateFormatter.current.format(now)
    });
  }, [timezone]); // Removed isRealTimezone from deps - it's a pure function that doesn't change

  // Time and date updates - aligned to minute boundary with drift correction
  // Only update when we have a real timezone (not UTC)
  useEffect(() => {
    if (!isRealTimezone(timezone) || !timeFormatter.current || !dateFormatter.current) return;
    
    let isActive = true;
    let lastExpectedUpdate = 0;
    let driftCorrectionCount = 0;
    const MAX_DRIFT_CORRECTIONS = 10; // Prevent infinite drift corrections
    
    function updateTimeAndDate() {
      if (!isActive) return;
      
      try {
        const now = new Date();
        const formattedTime = timeFormatter.current!.format(now);
        setTimeDisplay({
          time: formattedTime,
          date: dateFormatter.current!.format(now)
        });
        
        // Drift correction: check if we're significantly off schedule
        const currentTime = now.getTime();
        const expectedTime = lastExpectedUpdate + 60000; // Expected next update time
        const drift = Math.abs(currentTime - expectedTime);
        
        // If we're more than 5 seconds off, resync to the next minute boundary
        if (lastExpectedUpdate > 0 && drift > 5000 && driftCorrectionCount < MAX_DRIFT_CORRECTIONS) {
          driftCorrectionCount++;
          resyncToMinuteBoundary();
          return;
        }
        
        lastExpectedUpdate = currentTime;
      } catch (error) {
        OverlayLogger.error('Time update failed', error);
        // Fallback to basic time display
        const now = new Date();
        setTimeDisplay({
          time: now.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true,
            timeZone: timezone || 'UTC'
          }),
          date: now.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            timeZone: timezone || 'UTC'
          })
        });
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
  }, [timezone]); // Removed isRealTimezone from deps - it's a pure function that doesn't change


  // Filter todos based on completion timestamps (hide if completed > 60 seconds ago)
  const visibleTodos = useMemo(() => {
    if (!settings.todos || settings.todos.length === 0) {
      return [];
    }

    const now = Date.now();
    const ONE_MINUTE = 60 * 1000; // 60 seconds in milliseconds

    return settings.todos.filter((todo) => {
      if (!todo.completed) {
        // Always show incomplete todos
        return true;
      }
      
      // For completed todos, check if they were completed less than 60 seconds ago
      const completionTime = completedTodoTimestamps.get(todo.id);
      if (!completionTime) {
        // No completion timestamp in state - check localStorage for persistence
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const storedTimestamps = JSON.parse(stored) as Record<string, number>;
            const storedTimestamp = storedTimestamps[todo.id];
            
            if (storedTimestamp) {
              // Found in localStorage - check if it's still within 60 seconds
              const timeSinceCompletion = now - storedTimestamp;
              const shouldShow = timeSinceCompletion < ONE_MINUTE;
              if (!shouldShow) {
                OverlayLogger.overlay(`Hiding completed todo ${todo.id} - completed ${Math.round(timeSinceCompletion / 1000)}s ago`);
              }
              return shouldShow;
            }
          }
        } catch (error) {
          // If localStorage check fails, show the todo (graceful degradation)
          OverlayLogger.warn('Failed to check localStorage for todo visibility', { error });
          return true;
        }
        
        // No timestamp found in localStorage - this means it was completed more than 60 seconds ago
        // and was cleaned up, OR it was never tracked. Hide it to be safe.
        OverlayLogger.overlay(`Hiding completed todo ${todo.id} - no timestamp found`);
        return false;
      }
      
      const timeSinceCompletion = now - completionTime;
      const shouldShow = timeSinceCompletion < ONE_MINUTE;
      if (!shouldShow) {
        OverlayLogger.overlay(`Hiding completed todo ${todo.id} - completed ${Math.round(timeSinceCompletion / 1000)}s ago`);
      }
      return shouldShow;
    });
  }, [settings.todos, completedTodoTimestamps]);

  // Load completed todo timestamps from localStorage on mount and set up timers
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Only log if there are timestamps to load (reduces noise)
      if (stored) {
        const timestamps = JSON.parse(stored) as Record<string, number>;
        const now = Date.now();
        const ONE_MINUTE = 60 * 1000;
        
        // Filter out timestamps older than 60 seconds (cleanup old data)
        const validTimestamps = new Map<string, number>();
        Object.entries(timestamps).forEach(([id, timestamp]) => {
          const timeSinceCompletion = now - timestamp;
          if (timeSinceCompletion < ONE_MINUTE) {
            validTimestamps.set(id, timestamp);
            
            // Set up timer to hide this todo when it reaches 60 seconds
            const remainingTime = ONE_MINUTE - timeSinceCompletion;
            const timer = setTimeout(() => {
              setCompletedTodoTimestamps((current) => {
                const updated = new Map(current);
                updated.delete(id);
                return updated;
              });
              completedTodoTimersRef.current.delete(id);
            }, remainingTime);
            
            completedTodoTimersRef.current.set(id, timer);
          }
        });
        
        setCompletedTodoTimestamps(validTimestamps);
        // Only log if we actually loaded timestamps (reduces noise on fresh loads)
        if (validTimestamps.size > 0) {
          OverlayLogger.overlay(`Loaded ${validTimestamps.size} completed todo timestamps from localStorage`);
        }
        
        // Don't clean up localStorage here - keep old timestamps so we can check them later
        // Old timestamps (> 60 seconds) will be filtered out in visibleTodos and tracking logic
      }
    } catch (error) {
      // Ignore localStorage errors (e.g., in private browsing mode)
      OverlayLogger.warn('Failed to load completed todo timestamps from localStorage', { error });
    }
  }, []); // Run once on mount

  // Persist completed todo timestamps to localStorage whenever they change
  // Also clean up old timestamps (> 60 seconds) periodically
  useEffect(() => {
    try {
      const now = Date.now();
      const ONE_MINUTE = 60 * 1000;
      
      // Load existing timestamps to preserve ones not in current state
      const existing = localStorage.getItem(STORAGE_KEY);
      const allTimestamps: Record<string, number> = existing 
        ? JSON.parse(existing) as Record<string, number>
        : {};
      
      // Update with current state timestamps
      completedTodoTimestamps.forEach((timestamp, id) => {
        allTimestamps[id] = timestamp;
      });
      
      // Clean up timestamps older than 60 seconds
      const cleaned: Record<string, number> = {};
      Object.entries(allTimestamps).forEach(([id, timestamp]) => {
        const timeSinceCompletion = now - timestamp;
        if (timeSinceCompletion < ONE_MINUTE) {
          cleaned[id] = timestamp;
        }
      });
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch (error) {
      // Ignore localStorage errors (e.g., quota exceeded)
      OverlayLogger.warn('Failed to save completed todo timestamps to localStorage', { error });
    }
  }, [completedTodoTimestamps]);

  // Track when todos are marked complete and set timer to hide them after 60 seconds
  useEffect(() => {
    if (!settings.todos || settings.todos.length === 0) {
      // Clear timestamps and timers if todos are cleared
      setCompletedTodoTimestamps(new Map());
      completedTodoTimersRef.current.forEach((timer) => clearTimeout(timer));
      completedTodoTimersRef.current.clear();
      return;
    }

    const now = Date.now();
    const ONE_MINUTE = 60 * 1000; // 60 seconds in milliseconds

    // Use functional update to avoid dependency on completedTodoTimestamps
    setCompletedTodoTimestamps((prevTimestamps) => {
      const newTimestamps = new Map(prevTimestamps);

      if (!settings.todos) return newTimestamps;

      // Track newly completed todos
      settings.todos.forEach((todo) => {
        if (todo.completed) {
          // Check if this todo was just completed (not in timestamps yet)
          if (!prevTimestamps.has(todo.id)) {
            // Check localStorage to see if this was completed before (persistence check)
            try {
              const stored = localStorage.getItem(STORAGE_KEY);
              if (stored) {
                const storedTimestamps = JSON.parse(stored) as Record<string, number>;
                const storedTimestamp = storedTimestamps[todo.id];
                
                if (storedTimestamp) {
                  // Found in localStorage - check if it's still within 60 seconds
                  const timeSinceCompletion = now - storedTimestamp;
                  if (timeSinceCompletion < ONE_MINUTE) {
                    // Still within 60 seconds - use the stored timestamp
                    newTimestamps.set(todo.id, storedTimestamp);
                    
                    // Set up timer for remaining time
                    const remainingTime = ONE_MINUTE - timeSinceCompletion;
                    const timer = setTimeout(() => {
                      setCompletedTodoTimestamps((current) => {
                        const updated = new Map(current);
                        updated.delete(todo.id);
                        return updated;
                      });
                      completedTodoTimersRef.current.delete(todo.id);
                    }, remainingTime);
                    
                    completedTodoTimersRef.current.set(todo.id, timer);
                    return; // Skip adding new timestamp
                  }
                  // If stored timestamp is > 60 seconds old, don't add it (todo will be hidden)
                  // Todo was completed more than 60 seconds ago - don't add timestamp (no logging for routine operation)
                  return; // Don't add timestamp, todo will be filtered out
                }
              }
            } catch (error) {
              // If localStorage check fails, proceed with new timestamp
              OverlayLogger.warn('Failed to check localStorage for todo timestamp', { error });
            }
            
            // No stored timestamp or it's expired - record new timestamp
            newTimestamps.set(todo.id, now);
            
            // Set timer to hide this specific todo after 60 seconds
            const timer = setTimeout(() => {
              setCompletedTodoTimestamps((current) => {
                const updated = new Map(current);
                updated.delete(todo.id);
                return updated;
              });
              completedTodoTimersRef.current.delete(todo.id);
            }, ONE_MINUTE);
            
            completedTodoTimersRef.current.set(todo.id, timer);
          }
        } else {
          // Todo is incomplete - remove from timestamps if it was there
          if (prevTimestamps.has(todo.id)) {
            // Clear timer if it exists
            const timer = completedTodoTimersRef.current.get(todo.id);
            if (timer) {
              clearTimeout(timer);
              completedTodoTimersRef.current.delete(todo.id);
            }
            newTimestamps.delete(todo.id);
          }
        }
      });

      // Remove timestamps for todos that no longer exist
      prevTimestamps.forEach((timestamp, todoId) => {
        const todoExists = settings.todos?.some((t) => t.id === todoId);
        if (!todoExists) {
          const timer = completedTodoTimersRef.current.get(todoId);
          if (timer) {
            clearTimeout(timer);
            completedTodoTimersRef.current.delete(todoId);
          }
          newTimestamps.delete(todoId);
        }
      });

      return newTimestamps;
    });
  }, [settings.todos]); // Removed completedTodoTimestamps from dependencies to avoid infinite loop

  // Load settings and set up real-time updates
  useEffect(() => {
    // Helper function to create a stable hash from settings (sorts keys for consistency)
    const createSettingsHash = (settings: OverlaySettings): string => {
      const sorted = Object.keys(settings).sort().reduce((acc, key) => {
        acc[key] = settings[key as keyof OverlaySettings];
        return acc;
      }, {} as Record<string, unknown>);
      return JSON.stringify(sorted);
    };
    
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
          // Set initial hash to prevent false positives on first poll
          lastSettingsHash.current = createSettingsHash(data);
        }
        // If no data but request succeeded, keep existing settings (don't reset to defaults)
      } catch (error) {
        // Failed to load settings - keep existing settings instead of resetting
        // This ensures elements stay visible even when API fails
        OverlayLogger.warn('Settings load failed, keeping existing settings', { error });
        // Don't reset to defaults - keep what we have
      }
    };
    
    // Set up Server-Sent Events for real-time updates (disabled if KV not available)
    const setupSSE = () => {
      // Check if KV is available before setting up SSE
      if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        OverlayLogger.overlay('SSE disabled: Vercel KV not configured');
        return null;
      }
      
      const eventSource = new EventSource('/api/settings-stream');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'settings_update') {
            // Extract only settings properties, exclude SSE metadata (type, timestamp)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { type: _type, timestamp: _timestamp, ...settingsData } = data;
            OverlayLogger.settings('Settings updated via SSE', { 
              locationDisplay: settingsData.locationDisplay,
              showWeather: settingsData.showWeather,
              showMinimap: settingsData.showMinimap 
            });
            setSettings(settingsData as OverlaySettings);
            // Update hash to prevent polling from detecting this as a new change
            lastSettingsHash.current = createSettingsHash(settingsData as OverlaySettings);
          }
      } catch {
          // Ignore malformed SSE messages
        }
      };
      
      eventSource.onerror = () => {
        // Don't log SSE errors as they're common during development and not critical
        // Close the current connection before reconnecting
        try {
          eventSource.close();
        } catch {
          // Ignore close errors
        }
        // Reconnect after 1 second delay
        const reconnectDelay = 1000;
        setTimeout(() => {
          try {
            setupSSE();
          } catch {
            // Ignore reconnection errors
          }
        }, reconnectDelay);
      };
      
      return eventSource;
    };
    
    // Load initial settings
    loadSettings();
    
    // Set up real-time updates
    const eventSource = setupSSE();
    
    // Fallback polling mechanism - check for settings changes every 2 seconds for faster updates
    const pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, { 
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data) {
            const newHash = createSettingsHash(data);
            if (newHash !== lastSettingsHash.current) {
              lastSettingsHash.current = newHash;
              OverlayLogger.settings('Settings updated via polling', { 
                locationDisplay: data.locationDisplay,
                showWeather: data.showWeather,
                showMinimap: data.showMinimap 
              });
              setSettings(data); // UI updates immediately - this triggers location re-formatting
            }
          }
        }
      } catch (error) {
        // Log polling errors for debugging
        OverlayLogger.warn('Settings polling failed', { error });
      }
    }, SETTINGS_POLLING_INTERVAL);
    
    // Cleanup on unmount
    return () => {
      if (eventSource) {
        eventSource.close();
      }
      clearInterval(pollingInterval);
    };
  }, []); // Empty dependency array - we want this to run once on mount

  // RTIRL connection - use refs to avoid re-running on timezone/settings changes
  const timezoneRef = useRef(timezone);
  const createDateTimeFormattersRef = useRef(createDateTimeFormatters);
  const updateMinimapVisibilityRef = useRef(updateMinimapVisibility);
  const settingsRef = useRef(settings);
  
  // Update refs when values change (needed for RTIRL listener closure)
  useEffect(() => {
    timezoneRef.current = timezone;
    createDateTimeFormattersRef.current = createDateTimeFormatters;
    updateMinimapVisibilityRef.current = updateMinimapVisibility;
    settingsRef.current = settings;
  }, [timezone, createDateTimeFormatters, updateMinimapVisibility, settings]);

  // Preload flag image when country code is available
  useEffect(() => {
    if (location?.countryCode) {
      setFlagLoaded(false); // Reset flag loaded state when country changes
      const img = new Image();
      let isActive = true; // Track if component is still mounted
      
      img.onload = () => {
        if (isActive) setFlagLoaded(true);
      };
      img.onerror = () => {
        if (isActive) setFlagLoaded(false);
      };
      img.src = `https://flagcdn.com/${location.countryCode}.svg`;
      
      // Cleanup: prevent state updates if component unmounts or country changes
      return () => {
        isActive = false;
        // Clear image reference to allow garbage collection
        img.src = '';
      };
    }
  }, [location?.countryCode]);



  // RTIRL connection - use ref to track if listener is already set up
  const rtirlListenerSetupRef = useRef(false);
  
  useEffect(() => {
    // Prevent multiple listener setups if component remounts
    if (rtirlListenerSetupRef.current) {
      return;
    }
    
    const setupRTIRLListener = () => {
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        // Mark as set up to prevent duplicates
        rtirlListenerSetupRef.current = true;
        
        try {
          window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
            try {
              if (!p || typeof p !== 'object') {
                return;
              }
              const payload = p as RTIRLPayload;
              
              // RTIRL payload received - only log in development if needed for debugging
              // Removed verbose logging to reduce console spam
              
              // Handle timezone from RTIRL
              if (payload.location?.timezone && payload.location.timezone !== timezoneRef.current) {
                try {
                  createDateTimeFormattersRef.current(payload.location.timezone);
                  setTimezone(payload.location.timezone);
                } catch {
                  // Ignore timezone errors
                }
              }
              
              // Extract GPS coordinates
              const coords = extractCoordinates(payload);
              if (!coords) return;
              
              const [lat, lon] = coords;
              setMapCoords([lat, lon]);
              
              // Get GPS update timestamp from payload
              const gpsUpdateTime = extractGpsTimestamp(payload);
              const now = Date.now();
              
              // Check if GPS data was stale BEFORE this update (for speed calculation)
              // Use GPS timestamp, not reception time, to handle network delays and RTIRL throttling
              const timeSinceLastGps = lastGpsUpdateTime.current > 0 ? (now - lastGpsUpdateTime.current) : Infinity;
              const wasGpsDataStale = timeSinceLastGps > GPS_STALE_TIMEOUT;
              
              // Update GPS timestamps AFTER checking for staleness
              const isFirstGpsUpdate = lastGpsUpdateTime.current === 0;
              lastGpsUpdateTime.current = now; // Track last GPS reception time for staleness detection
              lastGpsTimestamp.current = gpsUpdateTime; // Track actual GPS timestamp from payload
              
              // Check if GPS update is fresh
              const isFresh = isGpsUpdateFresh(gpsUpdateTime, now);
              const isFirstFreshGps = !hasReceivedFreshGps && isFresh;
              
              // Check if we're still actively receiving GPS updates (even if stationary)
              // If RTIRL continues sending updates, keep location visible regardless of reportedAt age
              const isReceivingUpdates = !wasGpsDataStale; // If GPS wasn't stale before this update, we're receiving updates
              
              // Only show if GPS update is fresh OR we're still actively receiving updates
              // This handles the case where you're stationary but RTIRL continues sending updates
              if (isFresh || (isReceivingUpdates && !isFirstGpsUpdate)) {
                // Mark that we've received a fresh GPS update (for location/weather display)
                markGpsReceived();
                
                // Clear any existing hide timeout - we have fresh GPS data or are receiving updates
                clearTimer(locationWeatherHideTimeoutRef);
                
                // Only set timeout if the reportedAt timestamp is actually old
                // If we're receiving updates, don't hide even if reportedAt is old (RTIRL might cache timestamps)
                const timeSinceReportedAt = now - gpsUpdateTime;
                const timeUntilStale = GPS_FRESHNESS_TIMEOUT - timeSinceReportedAt;
                
                // Don't hide overlay when GPS becomes stale - keep showing valid cached data
                // GPS staleness only affects minimap visibility, not the main overlay
                // The overlay will remain visible as long as we have valid location/weather data
                if (timeUntilStale <= 0 && wasGpsDataStale) {
                  // GPS update is stale but keep showing overlay if we have valid data
                  markGpsStale(); // This only affects minimap visibility, not main overlay
                  OverlayLogger.warn('GPS update is stale and no longer receiving updates - minimap will hide, but overlay stays visible', {
                    reportedAt: gpsUpdateTime,
                    timeSinceReportedAt: now - gpsUpdateTime,
                    wasReceivingUpdates: !wasGpsDataStale
                  });
                }
                // Removed timeout that would hide overlay - keep showing valid cached data indefinitely
                // If we're receiving updates, don't set a timeout - keep showing location
              } else if (isFirstGpsUpdate) {
                // First GPS update AND it's stale - only clear if both weather and location data are also stale
                // Keep data if it's still valid (within validity timeout)
                const weatherAge = lastSuccessfulWeatherFetch.current > 0 
                  ? now - lastSuccessfulWeatherFetch.current 
                  : Infinity;
                const locationAge = lastSuccessfulLocationFetch.current > 0 
                  ? now - lastSuccessfulLocationFetch.current 
                  : Infinity;
                if (weatherAge > WEATHER_DATA_VALIDITY_TIMEOUT && locationAge > LOCATION_DATA_VALIDITY_TIMEOUT) {
                  setWeather(null);
                  setLocation(null);
                  OverlayLogger.warn('First GPS update is stale and both weather/location data are old - clearing');
                } else {
                  // Keep data even if GPS is stale initially - show overlay if we have valid data
                  // Set hasReceivedFreshGps to true so overlay appears even with stale initial GPS
                  markGpsReceived();
                  OverlayLogger.warn('First GPS update is stale but data is still valid - keeping cached data and showing overlay');
                }
              }
              
              // Get previous coordinates and GPS timestamp for speed calculation
              const prevCoords = lastCoords.current;
              const prevGpsTimestamp = lastGpsTimestamp.current;
              
              // Calculate speed from RTIRL payload and coordinates
              const speedKmh = calculateSpeed(
                payload,
                lat,
                lon,
                prevCoords,
                prevGpsTimestamp,
                gpsUpdateTime,
                wasGpsDataStale
              );
              const roundedSpeed = Math.round(speedKmh);
              
              setCurrentSpeed(roundedSpeed);
              
              // Store coordinates and timestamps for next speed calculation
              lastCoords.current = [lat, lon];
              lastCoordsTime.current = now; // Reception time (for staleness detection)
              // Note: lastGpsTimestamp.current is already updated above
              
              // Trigger minimap visibility update after GPS data is processed
              // This will check for movement and update minimap visibility accordingly
              try {
                updateMinimapVisibilityRef.current();
              } catch (error) {
                OverlayLogger.error('Failed to update minimap visibility', error);
                // Don't throw - allow overlay to continue functioning
              }
              
              // Kick off location + weather fetches on coordinate updates with gating
              (async () => {
                const movedMeters = prevCoords ? distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]) : Infinity;

              // Adaptive location update threshold based on speed
              // Use the newly calculated speed (roundedSpeed) instead of currentSpeed state
              // This avoids race condition where currentSpeed hasn't updated yet
              const speedForThreshold = roundedSpeed;
              const adaptiveLocationThreshold = speedForThreshold > 200 
                ? 1000  // 1km threshold for flights (>200 km/h)
                : speedForThreshold > 50 
                  ? 100  // 100m threshold for driving (50-200 km/h)
                  : 10; // 10m threshold for walking (<50 km/h)

              // Determine what needs to be fetched
              const weatherElapsed = now - lastWeatherTime.current;
              const locationElapsed = now - lastLocationTime.current;
              const meetsDistance = movedMeters >= adaptiveLocationThreshold;
              
              // Weather updates every 5 minutes regardless of movement
              // BUT: Force fetch if this is the first fresh GPS update (to ensure weather appears)
              // Also fetch if we don't have weather data yet or weather is getting stale
              const hasWeatherData = lastSuccessfulWeatherFetch.current > 0;
              const weatherDataAge = hasWeatherData 
                ? now - lastSuccessfulWeatherFetch.current 
                : Infinity;
              const shouldFetchWeather = lastWeatherTime.current === 0 || 
                weatherElapsed >= TIMERS.WEATHER_UPDATE_INTERVAL ||
                isFirstFreshGps || // Force fetch on first fresh GPS
                (!hasWeatherData && isFresh) || // Fetch if no weather and GPS is fresh
                (weatherDataAge >= WEATHER_DATA_VALIDITY_TIMEOUT && isFresh); // Fetch if weather is stale and GPS is fresh
              
              // Location updates: respect API limits (1/sec + 5,000/day)
              // 
              // Rate limiting strategy uses TWO layers of protection:
              // 1. Time gate: Minimum 18 seconds between calls (ensures ~4,800 calls/day max, safely under 5,000/day limit)
              //    - Calculation: 5,000/day = ~208/hour = ~3.5/min = 1 call every ~17.3 seconds
              //    - Using 18 seconds provides safety margin
              // 2. Rate limiter: checkRateLimit('locationiq') enforces 1 call/second + daily counter
              //    - Prevents burst traffic if multiple GPS updates arrive quickly
              //    - Tracks daily usage and blocks if daily limit (4,500/day) is reached
              //
              // Why both? The time gate prevents excessive calls during normal operation, while the rate limiter
              // handles edge cases (rapid GPS updates, app restarts, etc.) and provides daily limit protection.
              // Also requires distance threshold to avoid unnecessary calls when stationary.
              // We need country name/flag even in custom location mode
              const LOCATION_MIN_INTERVAL = 18000; // 18 seconds minimum (safely under 5,000/day limit)
              const shouldFetchLocation = lastLocationTime.current === 0 || 
                (locationElapsed >= LOCATION_MIN_INTERVAL && meetsDistance);
              
              // If settings just updated (hash changed), allow UI update but do not force API refetch here
              // API fetching remains purely based on the time/distance gates above

              // Fetch weather and location in parallel for faster loading
              // Fetch weather if GPS is fresh OR if it's the first update and GPS update is recent
              // This ensures weather/sunriseSunset are fetched even on initial load with recent data
              const promises: Promise<void>[] = [];
              
              // Fetch weather even if GPS is stale - we need timezone for overlay to show
              // Weather data will be cached and shown when GPS becomes fresh
              // Check rate limits: 50 per minute (well under 60/min free tier limit)
              const shouldFetchWeatherNow = shouldFetchWeather && API_KEYS.OPENWEATHER && 
                !weatherFetchInProgress.current && // Prevent concurrent weather fetches
                checkRateLimit('openweathermap'); // Check rate limits before fetching
              
              if (shouldFetchWeatherNow) {
                weatherFetchInProgress.current = true; // Mark as in progress
                promises.push(
                  (async () => {
                    try {
                      const weatherResult = await safeApiCall(
                        () => fetchWeatherAndTimezoneFromOpenWeatherMap(lat!, lon!, API_KEYS.OPENWEATHER!),
                        'Weather fetch'
                      );
                      
                      lastWeatherTime.current = Date.now();
                    if (weatherResult && typeof weatherResult === 'object' && 'weather' in weatherResult) {
                      const result = weatherResult as { 
                        weather?: { temp: number; desc: string }; 
                        timezone?: string;
                        sunriseSunset?: SunriseSunsetData;
                      };
                      
                      if (result.weather) {
                        updateWeather(result.weather);
                      } else {
                        OverlayLogger.warn('Weather result missing weather data');
                      }
                      
                      // OpenWeatherMap timezone is ONLY a fallback (less accurate than LocationIQ)
                      if (result.timezone && !isRealTimezone(timezone)) {
                        updateTimezone(result.timezone);
                      }
                      
                      if (result.sunriseSunset) {
                        setSunriseSunset(result.sunriseSunset);
                        // Sunrise/sunset data is already logged by API logger, no need to duplicate
                      }
                    } else {
                      // OpenWeatherMap failed - don't clear existing weather, keep showing last known weather
                      // Only use fallback if we have no weather data at all
                      if (!weather) {
                        OverlayLogger.warn('OpenWeatherMap failed and no cached weather, using fallbacks');
                        const fallbackWeather = createWeatherFallback();
                        if (fallbackWeather) {
                          updateWeather(fallbackWeather);
                        }
                      } else {
                        OverlayLogger.warn('OpenWeatherMap failed, keeping existing weather data');
                      }
                      
                      // Use fallback sunrise/sunset
                      const fallbackSunriseSunset = createSunriseSunsetFallback(timezone || undefined);
                      if (fallbackSunriseSunset) {
                        setSunriseSunset(fallbackSunriseSunset);
                      }
                    }
                    } catch (error) {
                      OverlayLogger.error('OpenWeatherMap API exception', error);
                    } finally {
                      weatherFetchInProgress.current = false; // Always clear flag, even on error
                    }
                  })()
                );
              }
              
              const shouldFetchLocationNow = shouldFetchLocation && !locationFetchInProgress.current; // Prevent concurrent location fetches
              
              if (shouldFetchLocationNow) {
                locationFetchInProgress.current = true; // Mark as in progress
                promises.push(
                  (async () => {
                    try {
                    // Capture request timestamp to prevent race conditions
                    // If multiple requests are in flight, only use the most recent result
                    const requestTimestamp = Date.now();
                    
                    let loc: LocationData | null = null;
                    
                    // Fetch location from LocationIQ
                    let locationIQWas404 = false;
                    let locationIQRateLimited = false;
                    
                    if (API_KEYS.LOCATIONIQ) {
                      // Check rate limits: 1 per second + 5,000 per day
                      if (checkRateLimit('locationiq')) {
                      const locationResult = await safeApiCall(
                        () => fetchLocationFromLocationIQ(lat!, lon!, API_KEYS.LOCATIONIQ!),
                        'LocationIQ fetch'
                      );
                        if (locationResult && typeof locationResult === 'object' && 'location' in locationResult) {
                          const result = locationResult as { location: LocationData | null; was404: boolean };
                          loc = result.location;
                          locationIQWas404 = result.was404;
                      }
                      } else {
                        // Rate limited - don't use fallback yet, wait for next update
                        locationIQRateLimited = true;
                        OverlayLogger.warn('LocationIQ rate limited, skipping fetch - will retry on next GPS update');
                      }
                    }
                    
                    // Only update if this is still the most recent request
                    // Prevents race conditions where older requests complete after newer ones
                    if (requestTimestamp >= lastLocationTime.current) {
                      lastLocationTime.current = requestTimestamp;
                    
                    // Check if LocationIQ returned useful data (more than just country)
                    const hasUsefulData = loc && (
                      loc.city || loc.town || loc.village || loc.municipality ||
                      loc.neighbourhood || loc.suburb || loc.district
                    );
                    
                    const hasCountryData = loc && loc.country;
                    
                    if (loc && hasUsefulData) {
                      // Full location data available - use it
                      // Use settingsRef to get the current settings value (not stale closure value)
                      const currentDisplayMode = settingsRef.current.locationDisplay;
                      const formatted = formatLocation(loc, currentDisplayMode);
                      lastRawLocation.current = loc;
                        
                        // Only update if we have something meaningful to display
                        // Check for non-empty strings (not just truthy, since empty string is falsy)
                        if (formatted.primary.trim() || formatted.country) {
                        // Log location updates with essential info only (reduce verbosity)
                        // Full rawData is available in API logger if needed for debugging
                        OverlayLogger.location('Location updated', {
                          mode: currentDisplayMode,
                          primary: formatted.primary.trim() || 'none',
                          secondary: formatted.country || 'none', // Secondary line (city/state/country depending on primary category)
                          city: loc.city || loc.town || 'none',
                          neighbourhood: loc.neighbourhood || loc.suburb || 'none',
                          state: loc.state || loc.province || loc.region || 'none',
                          country: loc.country || 'none'
                        });
                        updateLocation({
                          primary: formatted.primary.trim() || '',
                          country: formatted.country,
                          countryCode: loc.countryCode || ''
                        });
                        setHasIncompleteLocationData(false);
                      }
                      
                      // PRIORITY: LocationIQ timezone is ALWAYS preferred (accurate IANA timezone)
                      if (loc.timezone) {
                        updateTimezone(loc.timezone);
                      }
                      // Note: If LocationIQ doesn't provide timezone, OpenWeatherMap will set it as fallback
                    } else if (hasCountryData) {
                      // Only country data available
                      // If LocationIQ returned a country, we're on land (not in water)
                      // LocationIQ doesn't return country data for open water coordinates
                      const rawCountryName = loc!.country?.trim() || '';
                      const countryCode = loc!.countryCode || '';
                      
                      // If we only have country name but no country code, hide the entire top-right section
                      // This avoids showing incomplete data - better to hide than show without flag
                      if (!countryCode) {
                        OverlayLogger.warn('LocationIQ returned only country data without country code - hiding top-right section', {
                          country: rawCountryName
                        });
                        // Clear location and mark as incomplete to hide the entire section
                        setLocation(null);
                        setHasIncompleteLocationData(true);
                        // Don't update lastSuccessfulLocationFetch - we're hiding, not caching
                      } else if (rawCountryName) {
                        // We have both country name and code - safe to display
                        setHasIncompleteLocationData(false);
                        // We have both country name and code - safe to display
                        OverlayLogger.warn('LocationIQ returned only country data, using country name');
                        // Format country name (e.g., "United States of America" -> "USA")
                        const formattedCountryName = formatCountryName(rawCountryName, countryCode);
                        updateLocation({
                          primary: formattedCountryName,
                          country: undefined,
                          countryCode: countryCode
                        });
                      }
                      
                      // Use timezone if available
                      if (loc!.timezone) {
                        updateTimezone(loc!.timezone);
                      }
                    } else if (!locationIQRateLimited) {
                      // LocationIQ failed completely (not rate-limited), use country-only fallback
                      // Never show coordinates - only show country if estimable, or ocean names if on water
                      OverlayLogger.warn('LocationIQ failed, using country-only fallback');
                      
                      const fallbackLocation = createLocationWithCountryFallback(lat!, lon!, locationIQWas404);
                      if (fallbackLocation.country || (fallbackLocation.primary && fallbackLocation.primary.trim())) {
                        updateLocation({
                          primary: fallbackLocation.primary.trim() || '',
                          country: fallbackLocation.country,
                          countryCode: fallbackLocation.countryCode || ''
                        });
                        setHasIncompleteLocationData(false);
                        // IMPORTANT: Don't update lastRawLocation.current with fallback data
                        // This ensures settings changes don't try to format incomplete country-only data
                        // Only update lastRawLocation when we have full location data from LocationIQ
                      }
                      // If no country can be estimated and not on water, don't update location (keep existing or blank)
                    }
                    // If rate-limited, don't update location - keep existing location or wait for next update
                    // If fetch failed, don't clear location - keep showing last known location
                    // IMPORTANT: lastRawLocation.current is only updated when we have full location data (line 1391)
                    // This ensures settings changes can properly re-format location data
                    } // End of race condition check
                    } catch (error) {
                      OverlayLogger.error('Location fetch error', { error });
                    } finally {
                      locationFetchInProgress.current = false; // Always clear flag, even on error
                    }
                  })()
                );
              }
              
                // Wait for all parallel requests to complete
                if (promises.length > 0) {
                  await Promise.all(promises);
                }
              })();
            } catch (error) {
              OverlayLogger.error('RTIRL listener error', error);
            }
          });
        } catch (error) {
          OverlayLogger.error('Failed to register RTIRL listener', error);
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
        setupRTIRLListener();
      };
      document.body.appendChild(script);
    }

    // RTIRL script cleanup handled automatically
    // Note: Functions (checkRateLimit, safeApiCall) are not in deps because:
    // 1. They're used inside the listener callback, not during setup
    // 2. The listener is set up once and doesn't need to be recreated when functions change
    // 3. If functions need to access latest values, they should use refs (which they already do)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      // Reset flag on unmount so listener can be set up again if component remounts
      rtirlListenerSetupRef.current = false;
    };
  }, []); // Empty deps - RTIRL listener should only be set up once on mount

  // Fade-in delay: Start overlay hidden, then fade in after 1.5 seconds to prevent flashing
  useEffect(() => {
    const fadeInTimer = setTimeout(() => {
      setOverlayVisible(true);
    }, 1500); // 1.5 second delay before fade-in

    return () => {
      clearTimeout(fadeInTimer);
    };
  }, []); // Run once on mount

  // Memoized display values
  const locationDisplay = useMemo(() => {
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      return {
        primary: settings.customLocation?.trim() || '',
        country: location?.country, // Secondary line (city/state/country) - in custom mode this shows the actual country name
        countryCode: location?.countryCode?.toUpperCase()
      };
    }
    
    // Show location data if available
    // For 'country' mode, primary will be empty but country field will have the country name
    if (location && (location.primary || location.country)) {
      return {
        ...location,
        countryCode: location.countryCode?.toUpperCase()
      };
    }
    
    // No location data yet - return null so UI stays blank
    return null;
  }, [location, settings.locationDisplay, settings.customLocation]);


  // Accurate day/night check using OpenWeatherMap sunrise/sunset data
  const isNightTime = (): boolean => {
    if (!sunriseSunset) {
      // Fallback to simple time-based check if no API data
      OverlayLogger.warn('No sunrise/sunset data available, using fallback detection');
      return isNightTimeFallback(timezone || undefined);
    }
    
    try {
      const now = new Date();
      const sunriseUTC = new Date(sunriseSunset.sunrise);
      const sunsetUTC = new Date(sunriseSunset.sunset);
      
      // Get current time components in the location's timezone
      const tz = timezone || 'UTC';
      const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
      const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
      const sunriseHour = parseInt(sunriseUTC.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
      const sunriseMin = parseInt(sunriseUTC.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
      const sunsetHour = parseInt(sunsetUTC.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
      const sunsetMin = parseInt(sunsetUTC.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
      
      // Convert to minutes since midnight for comparison
      const currentMinutes = currentHour * 60 + currentMinute;
      const sunriseMinutes = sunriseHour * 60 + sunriseMin;
      const sunsetMinutes = sunsetHour * 60 + sunsetMin;
      
      return currentMinutes < sunriseMinutes || currentMinutes > sunsetMinutes;
    } catch (error) {
      OverlayLogger.error('Day/night calculation error', error);
      return false;
    }
  };

  // Get weather icon based on description and time of day
  const getWeatherIcon = useCallback((desc: string): string => {
    const d = desc.toLowerCase();
    const isNight = isNightTime();
    
    // Clear/Sunny conditions - show sun during day, moon at night
    if (d.includes('clear') || d.includes('sunny')) {
      return isNight ? '🌙' : '☀️';
    }
    
    // Partly cloudy - show appropriate icon for day/night
    if (d.includes('partly') || d.includes('few clouds')) {
      return isNight ? '☁️' : '🌤️';
    }
    
    // Other conditions (same day or night)
    if (d.includes('cloud')) return '☁️';
    if (d.includes('rain') || d.includes('drizzle')) return '🌧️';
    if (d.includes('storm') || d.includes('thunder')) return '⛈️';
    if (d.includes('snow')) return '❄️';
    if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return '🌫️';
    if (d.includes('wind')) return '💨';
    
    // Default - check if night for fallback
    return isNight ? '🌙' : '🌤️';
  }, [isNightTime]);

  const weatherDisplay = useMemo(() => {
    if (!weather) {
    // No weather data - return null (no logging to reduce console spam)
    return null;
    }
    
    const display = {
      temperature: `${weather.temp}°C / ${celsiusToFahrenheit(weather.temp)}°F`,
      icon: getWeatherIcon(weather.desc)
    };
    return display;
  }, [weather, getWeatherIcon]); // getWeatherIcon already depends on sunriseSunset/timezone via isNightTime

  return (
    <ErrorBoundary autoReload={false}>
      <div
        className="overlay-container obs-render"
        style={{
          // Always show overlay - top-left (time/date/heart rate) doesn't depend on GPS or location data
          // Top-right section has its own visibility conditions
          // This ensures elements stay visible even if location/weather data is cleared due to errors
          // Start hidden and fade in after delay to prevent flashing on initial load
          opacity: overlayVisible ? 1 : 0,
          transition: overlayVisible ? 'opacity 0.8s ease-in-out' : 'none'
        }}
      >
        <div className="top-left">
          <div className="overlay-box">
            {/* Only show time when we have a real timezone (not UTC) */}
            {isRealTimezone(timezone) && timeDisplay.time && (
              <div className="time time-left time-line">
                <div className="time-display">
                  <span className="time-value">{timeDisplay.time.split(' ')[0]}</span>
                  <span className="time-period">{timeDisplay.time.split(' ')[1]}</span>
                </div>
              </div>
            )}

            {/* Only show date when we have a real timezone (not UTC) */}
            {isRealTimezone(timezone) && timeDisplay.date && (
              <div className="date date-left date-line">
                {timeDisplay.date}
              </div>
            )}
            
            {API_KEYS.PULSOID && (
              <ErrorBoundary fallback={<div className="heart-rate-line">Heart rate unavailable</div>}>
                <HeartRateMonitor 
                  pulsoidToken={API_KEYS.PULSOID} 
                />
              </ErrorBoundary>
            )}
          </div>
        </div>

        <div className="top-right">
          {/* Show right section if:
              1. Custom location mode (always show), OR
              2. We have valid data (location or weather) and no incomplete location data
              Don't hide just because GPS is stale - keep showing valid cached data */}
          {((settings.locationDisplay === 'custom') || ((location || weather) && !hasIncompleteLocationData)) && (
            <>
          {settings.locationDisplay !== 'hidden' && (
          <div className="overlay-box">
            {/* Show location if we have location data (or custom mode) - don't require fresh GPS */}
            {((settings.locationDisplay === 'custom') || locationDisplay) && locationDisplay && (
              <>
                  {locationDisplay.primary && (
                  <div className="location location-line">
                    <div className="location-main">{locationDisplay.primary}</div>
                  </div>
                  )}
                  {locationDisplay.country && (
                    // Only show secondary line (city/state/country) with flag if:
                    // 1. Not in custom mode (always show for GPS modes), OR
                    // 2. In custom mode AND showCountryName is enabled
                    (settings.locationDisplay !== 'custom' || settings.showCountryName) && (
                    <div className={`location location-line location-sub-line ${!locationDisplay.primary ? 'country-only' : ''}`}>
                      <div className="location-sub">
                        {locationDisplay.country}
                        {locationDisplay.countryCode && (
                          <LocationFlag 
                            countryCode={locationDisplay.countryCode} 
                            flagLoaded={flagLoaded} 
                            getEmojiFlag={getEmojiFlag} 
                          />
                        )}
                      </div>
                      </div>
                    )
                  )}
              </>
            )}
            
            {/* Weather - show if we have weather data and GPS is fresh */}
            {weatherDisplay && settings.showWeather && (
              <div className="weather weather-line">
                <div className="weather-container">
                  <div className="weather-content">
                    <div className="weather-temperature">
                      {weatherDisplay.temperature}
                    </div>
                    <span className="weather-icon">
                      {weatherDisplay.icon}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Minimap - also hidden until fresh GPS update */}
          {mapCoords && minimapVisible && (
            <div 
              className="minimap" 
              style={{ opacity: minimapOpacity }}
            >
              {sunriseSunset ? (
                <ErrorBoundary fallback={<div className="minimap-placeholder">Map unavailable</div>}>
                  <MapLibreMinimap 
                    lat={mapCoords[0]} 
                    lon={mapCoords[1]} 
                    isVisible={minimapVisible}
                    zoomLevel={settings.mapZoomLevel}
                    timezone={timezone || undefined}
                    isNight={isNightTime()}
                  />
                </ErrorBoundary>
              ) : (
                <div className="minimap-placeholder">Loading map...</div>
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* To-Do List - Bottom Right */}
        {/* Show todo list when enabled and there are visible todos */}
        {settings.showTodoList && visibleTodos.length > 0 && (
          <div className="bottom-right">
            <div className="overlay-box todo-list-box">
              {visibleTodos
                .sort((a, b) => {
                  // Incomplete tasks first, then completed tasks
                  if (a.completed === b.completed) return 0;
                  return a.completed ? 1 : -1;
                })
                .map((todo) => (
                  <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                    <span className="todo-checkbox-icon">{todo.completed ? '✓' : '☐'}</span>
                    <span className="todo-text">{todo.text}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

// Export wrapped version that doesn't auto-reload on errors
function OverlayPageWrapper() {
  return (
    <ErrorBoundary 
      autoReload={false} // Disable auto-reload - keep elements visible indefinitely
    >
      <OverlayPage />
    </ErrorBoundary>
  );
}

export default OverlayPageWrapper;
