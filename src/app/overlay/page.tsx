"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit } from '@/utils/unit-conversions';
import { API_KEYS, THRESHOLDS, TIMERS, DYNAMIC_TIMERS, type RTIRLPayload } from '@/utils/overlay-constants';
import { distanceInMeters } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ, type SunriseSunsetData } from '@/utils/api-utils';
import { formatLocation, formatCountryName, type LocationData } from '@/utils/location-utils';
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

export default function OverlayPage() {
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
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [flagLoaded, setFlagLoaded] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [minimapOpacity, setMinimapOpacity] = useState(0.95); // Track opacity for fade transitions
  const [hasReceivedFreshGps, setHasReceivedFreshGps] = useState(false); // Track if we've received at least one fresh GPS update
  const [hasIncompleteLocationData, setHasIncompleteLocationData] = useState(false); // Track if we have incomplete location data (country but no code)
  
  // Todo completion tracking with localStorage persistence
  const [completedTodoTimestamps, setCompletedTodoTimestamps] = useState<Map<string, number>>(new Map()); // Track when todos were completed
  const completedTodoTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map()); // Track timers for hiding completed todos
  const STORAGE_KEY = 'tazo-completed-todos'; // localStorage key for persistence
  
  // Track previous todo IDs and completion state for detecting changes
  const previousTodoIdsRef = useRef<Set<string>>(new Set()); // Track previous todo IDs to detect new items
  const previousTodoCompletionStateRef = useRef<Map<string, boolean>>(new Map()); // Track previous completion state to detect unchecked items

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastGpsUpdateTime = useRef(0); // Track when we last got GPS data (use ref for synchronous updates)
  const weatherFetchInProgress = useRef(false); // Track if weather fetch is already in progress
  const locationFetchInProgress = useRef(false); // Track if location fetch is already in progress
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const lastSettingsHash = useRef<string>('');
  const lastRawLocation = useRef<LocationData | null>(null);
  const lastSuccessfulWeatherFetch = useRef(0); // Track when weather was last successfully fetched
  const lastSuccessfulLocationFetch = useRef(0); // Track when location was last successfully fetched
  
  // API rate limiting tracking (per-second only)
  const lastLocationIqCall = useRef(0);
  
  // GPS update tracking for minimap
  const minimapFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // GPS freshness tracking for location/weather display
  const locationWeatherHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const GPS_FRESHNESS_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds
  const GPS_STALE_TIMEOUT = 10000; // 10 seconds - if no GPS update, data is stale
  const WEATHER_DATA_VALIDITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes - weather data is still valid even if GPS is stale
  const LOCATION_DATA_VALIDITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes - location data is still valid even if GPS is stale
  
  // Helper: Check if GPS update is fresh (simplifies complex conditionals)
  const isGpsUpdateFresh = useCallback((gpsUpdateTime: number, now: number, isFirstUpdate: boolean): boolean => {
    const timeSinceUpdate = now - gpsUpdateTime;
    const isRecent = timeSinceUpdate <= GPS_FRESHNESS_TIMEOUT;
    const wasStale = lastGpsUpdateTime.current > 0 && (now - lastGpsUpdateTime.current) > GPS_STALE_TIMEOUT;
    return isRecent && (!wasStale || isFirstUpdate);
  }, [GPS_FRESHNESS_TIMEOUT, GPS_STALE_TIMEOUT]);
  
  // Helper: Check if timezone is real (not UTC placeholder)
  const isRealTimezone = useCallback((tz: string | null): boolean => {
    return tz !== null && tz !== 'UTC';
  }, []);
  
  
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

  // Minimap visibility logic - simplified:
  // Show when moving faster than walking pace (> 5 km/h) and GPS is fresh
  // Hide when GPS data is stale (no updates in 10 seconds)
  const updateMinimapVisibility = useCallback(() => {
    const now = Date.now();
    const timeSinceLastGps = now - lastGpsUpdateTime.current;
    const isGpsStale = timeSinceLastGps > GPS_STALE_TIMEOUT;
    
    // Walking pace is ~4-5 km/h, so use 5 km/h as threshold
    const WALKING_PACE_THRESHOLD = 5; // km/h
    
    const fadeOutDuration = 1000; // 1 second fade out
    
    // Clear existing timers
    if (minimapFadeTimeoutRef.current) {
      clearTimeout(minimapFadeTimeoutRef.current);
      minimapFadeTimeoutRef.current = null;
    }
    
    if (settings.minimapSpeedBased) {
      // === SIMPLE LOGIC ===
      // Turn OFF: GPS data is stale (no updates in 10 seconds)
      if (isGpsStale) {
        setMinimapOpacity(0);
        minimapFadeTimeoutRef.current = setTimeout(() => {
        setMinimapVisible(false);
        }, fadeOutDuration);
        setCurrentSpeed(0);
      }
      // Turn ON: Speed > walking pace (5 km/h) and GPS is fresh
      else if (currentSpeed > WALKING_PACE_THRESHOLD) {
        // If fading out, cancel fade and show immediately
        if (minimapFadeTimeoutRef.current) {
          clearTimeout(minimapFadeTimeoutRef.current);
          minimapFadeTimeoutRef.current = null;
        }
        setMinimapVisible(true);
        setMinimapOpacity(0.95); // Full opacity
      }
      // Turn OFF: Speed <= walking pace
      else if (minimapVisible) {
        setMinimapOpacity(0);
        minimapFadeTimeoutRef.current = setTimeout(() => {
          setMinimapVisible(false);
        }, fadeOutDuration);
      }
    } else if (settings.showMinimap) {
      // Always show mode - ensure full opacity
      // If currently hidden, fade in smoothly
      if (!minimapVisible) {
      setMinimapVisible(true);
        setMinimapOpacity(0);
        requestAnimationFrame(() => {
          setMinimapOpacity(0.95);
        });
    } else {
        setMinimapOpacity(0.95);
      }
    } else {
      // Hidden mode - fade out smoothly when manually toggled off
      if (minimapVisible) {
        // Start fade out
        setMinimapOpacity(0);
        minimapFadeTimeoutRef.current = setTimeout(() => {
      setMinimapVisible(false);
        }, fadeOutDuration);
      } else {
        // Already hidden
        setMinimapVisible(false);
        setMinimapOpacity(0);
    }
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, minimapVisible]);

  // Update settings hash and re-format location whenever settings change
  useEffect(() => {
    const newHash = JSON.stringify(settings);
    const hashChanged = newHash !== lastSettingsHash.current;
    lastSettingsHash.current = newHash;

    // Re-render location display instantly from cached raw data if available
    // This ensures location display updates immediately when settings change
    if (lastRawLocation.current && settings.locationDisplay !== 'hidden') {
      try {
        const formatted = formatLocation(lastRawLocation.current, settings.locationDisplay);
        // Always update location state when settings change, even if formatted result is empty
        // This ensures the display mode change is reflected immediately
        if (hashChanged) {
          OverlayLogger.location('Location display mode changed', {
            mode: settings.locationDisplay,
            display: formatted.primary || formatted.country || 'none',
            rawLocation: {
              city: lastRawLocation.current.city,
              neighbourhood: lastRawLocation.current.neighbourhood,
              suburb: lastRawLocation.current.suburb
            }
          });
        }
        setLocation({
          primary: formatted.primary || '',
          country: formatted.country,
          countryCode: lastRawLocation.current.countryCode || ''
        });
        setHasIncompleteLocationData(false); // Clear incomplete flag when re-formatting
      } catch (error) {
        OverlayLogger.warn('Location re-formatting failed on settings change', { error });
        // Ignore formatting errors; UI will update on next normal cycle
      }
    }
  }, [settings]);

  // Update minimap visibility when relevant state changes
  useEffect(() => {
    updateMinimapVisibility();
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, updateMinimapVisibility]);

  // Cleanup minimap and location/weather timers on unmount
  useEffect(() => {
    return () => {
      if (minimapFadeTimeoutRef.current) {
        clearTimeout(minimapFadeTimeoutRef.current);
      }
      if (locationWeatherHideTimeoutRef.current) {
        clearTimeout(locationWeatherHideTimeoutRef.current);
      }
      // Cleanup completed todo timers
      completedTodoTimersRef.current.forEach((timer) => clearTimeout(timer));
      completedTodoTimersRef.current.clear();
    };
  }, []);

  // Get emoji flag for country code (fast fallback)
  const getEmojiFlag = useCallback((countryCode: string): string => {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  }, []);



  // Check API rate limits (per-second cooldown only)
  const canMakeApiCall = useCallback((apiType: 'locationiq') => {
    const now = Date.now();

    if (apiType === 'locationiq') {
      const timeSinceLastCall = now - lastLocationIqCall.current;
      const cooldown = 1000; // 1 second cooldown for LocationIQ free tier
      
      if (timeSinceLastCall < cooldown) {
        OverlayLogger.warn('LocationIQ rate limit - too soon', {
          timeSinceLastCall,
          cooldown
        });
        return false;
      }
      
      return true;
    }
    
    return false;
  }, []);

  // Track API call (update last call time only)
  const trackApiCall = useCallback((apiType: 'locationiq') => {
    const now = Date.now();
    if (apiType === 'locationiq') {
      lastLocationIqCall.current = now;
    }
  }, []);




  

  // Refs
  const timeFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const timeUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const timeSyncTimeout = useRef<NodeJS.Timeout | null>(null);

  // Global error handling to prevent crashes and suppress harmless errors
  useEffect(() => {
    // Suppress known harmless errors from external scripts
    const suppressKnownErrors = (event: ErrorEvent) => {
      // RTIRL script tries to access Chrome APIs - suppress this harmless error
      if (event.message?.includes('chrome is not defined') || 
          (event.message?.includes('chrome') && event.filename?.includes('rtirl'))) {
        event.preventDefault();
        return true;
      }
      return false;
    };
    
    const handleError = (event: ErrorEvent) => {
      // Suppress known harmless errors
      if (suppressKnownErrors(event)) {
        return;
      }
      
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
      // Suppress Chrome API errors from RTIRL
      const reason = event.reason?.toString() || '';
      if (reason.includes('chrome is not defined') || reason.includes('chrome')) {
        event.preventDefault();
        return;
      }
      
      OverlayLogger.error('Unhandled promise rejection caught', {
        reason: event.reason,
        promise: event.promise
      });
      // Prevent the default behavior to avoid console errors
      event.preventDefault();
    };
    
    // Suppress React DevTools message (harmless informational message)
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0]?.toString().includes('Download the React DevTools')) {
        return; // Suppress React DevTools message
      }
      originalLog.apply(console, args);
    };
    
    // Override window.onerror to catch RTIRL chrome errors before they hit console
    const originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      if (typeof message === 'string' && message.includes('chrome is not defined')) {
        return true; // Suppress this harmless error
      }
      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error);
      }
      return false;
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      console.log = originalLog; // Restore original console.log
      window.onerror = originalOnError; // Restore original onerror
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
  
  // Update time display immediately when formatters are created and timezone is set
  useEffect(() => {
    if (!isRealTimezone(timezone) || !timeFormatter.current || !dateFormatter.current) return;
    
    // Immediately update time display when formatters are ready
    const now = new Date();
    setTimeDisplay({
      time: timeFormatter.current.format(now),
      date: dateFormatter.current.format(now)
    });
  }, [timezone, isRealTimezone]);

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
  }, [timezone, isRealTimezone]);

  // Track todo changes (for potential future use)
  useEffect(() => {
    if (!settings.todos || settings.todos.length === 0) {
      previousTodoIdsRef.current = new Set();
      previousTodoCompletionStateRef.current = new Map();
      return;
    }

    const currentTodoIds = new Set(settings.todos.map(todo => todo.id));
    const newCompletionState = new Map<string, boolean>();
    settings.todos.forEach(todo => {
      newCompletionState.set(todo.id, todo.completed);
    });

    // Update previous todo IDs and completion state
    previousTodoIdsRef.current = currentTodoIds;
    previousTodoCompletionStateRef.current = newCompletionState;
  }, [settings.todos]);

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
      OverlayLogger.overlay(`Loading completed todo timestamps from localStorage`, { 
        hasStored: !!stored,
        storageKey: STORAGE_KEY 
      });
      
      if (stored) {
        const timestamps = JSON.parse(stored) as Record<string, number>;
        const now = Date.now();
        const ONE_MINUTE = 60 * 1000;
        
        OverlayLogger.overlay(`Found ${Object.keys(timestamps).length} timestamps in localStorage`, {
          timestamps: Object.entries(timestamps).map(([id, ts]) => ({
            id,
            ageSeconds: Math.round((now - ts) / 1000)
          }))
        });
        
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
          } else {
            OverlayLogger.overlay(`Filtered out old timestamp for todo ${id}`, {
              ageSeconds: Math.round(timeSinceCompletion / 1000)
            });
          }
        });
        
        setCompletedTodoTimestamps(validTimestamps);
        OverlayLogger.overlay(`Loaded ${validTimestamps.size} valid timestamps into state`);
        
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
                  OverlayLogger.overlay(`Todo ${todo.id} was completed ${Math.round(timeSinceCompletion / 1000)}s ago - not adding to state, will be hidden`);
                  return; // Don't add timestamp, todo will be filtered out
                }
              }
            } catch (error) {
              // If localStorage check fails, proceed with new timestamp
              OverlayLogger.warn('Failed to check localStorage for todo timestamp', { error });
            }
            
            // No stored timestamp or it's expired - record new timestamp
            OverlayLogger.overlay(`Todo ${todo.id} is newly completed or expired - adding new timestamp`);
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
        } else {
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        }
      } catch {
        // Failed to load settings, using defaults
        setSettings(DEFAULT_OVERLAY_SETTINGS);
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
            const newHash = JSON.stringify(data);
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
    }, 2000); // Check every 2 seconds for faster updates
    
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
      img.onload = () => setFlagLoaded(true);
      img.onerror = () => setFlagLoaded(false);
      img.src = `https://flagcdn.com/${location.countryCode}.svg`;
    }
  }, [location?.countryCode]);



  // RTIRL connection
  useEffect(() => {
    const setupRTIRLListener = () => {
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
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
          let lat: number | null = null;
          let lon: number | null = null;
          if (payload.location) {
            if ('lat' in payload.location && 'lon' in payload.location) {
              lat = payload.location.lat;
              lon = payload.location.lon;
            } else if ('latitude' in payload.location && 'longitude' in payload.location) {
              lat = (payload.location as { latitude: number }).latitude;
              lon = (payload.location as { longitude: number }).longitude;
            }
          }
          
          if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon <= 180) {
            setMapCoords([lat, lon]);
            
            // Get GPS update timestamp from payload if available, otherwise use current time
            // RTIRL includes reportedAt and updatedAt fields - use reportedAt as it's when GPS was actually reported
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
            const gpsUpdateTime = payloadTimestamp && typeof payloadTimestamp === 'number' 
              ? payloadTimestamp 
              : Date.now();
            const now = Date.now();
            
            // Check if GPS data was stale BEFORE this update (for speed calculation)
            const timeSinceLastGps = lastGpsUpdateTime.current > 0 ? (now - lastGpsUpdateTime.current) : Infinity;
            const wasGpsDataStale = timeSinceLastGps > GPS_STALE_TIMEOUT;
            
            // Update GPS timestamp AFTER checking for staleness
            const isFirstGpsUpdate = lastGpsUpdateTime.current === 0;
            lastGpsUpdateTime.current = now; // Track last GPS update time for stale detection (synchronous)
            
            // Check if GPS update is fresh (simplified logic)
            // IMPORTANT: We check both the reportedAt timestamp AND whether we're still receiving updates
            // This ensures that if RTIRL continues sending updates when stationary, location stays visible
            const isFresh = isGpsUpdateFresh(gpsUpdateTime, now, isFirstGpsUpdate);
            const isFirstFreshGps = !hasReceivedFreshGps && isFresh;
            
            // Check if we're still actively receiving GPS updates (even if stationary)
            // If RTIRL continues sending updates, keep location visible regardless of reportedAt age
            const isReceivingUpdates = !wasGpsDataStale; // If GPS wasn't stale before this update, we're receiving updates
            
            // Only show if GPS update is fresh OR we're still actively receiving updates
            // This handles the case where you're stationary but RTIRL continues sending updates
            if (isFresh || (isReceivingUpdates && !isFirstGpsUpdate)) {
              // Mark that we've received a fresh GPS update (for location/weather display)
              if (!hasReceivedFreshGps) {
                setHasReceivedFreshGps(true);
                // Fresh GPS update received - showing location/weather
                // Removed verbose logging to reduce console spam
              }
              
              // Clear any existing hide timeout - we have fresh GPS data or are receiving updates
              if (locationWeatherHideTimeoutRef.current) {
                clearTimeout(locationWeatherHideTimeoutRef.current);
                locationWeatherHideTimeoutRef.current = null;
              }
              
              // Only set timeout if the reportedAt timestamp is actually old
              // If we're receiving updates, don't hide even if reportedAt is old (RTIRL might cache timestamps)
              const timeSinceReportedAt = now - gpsUpdateTime;
              const timeUntilStale = GPS_FRESHNESS_TIMEOUT - timeSinceReportedAt;
              
              // Only hide if BOTH conditions are met:
              // 1. The reportedAt timestamp is old (15+ minutes)
              // 2. We're not actively receiving updates (GPS was stale before this update)
              if (timeUntilStale <= 0 && wasGpsDataStale) {
                // GPS update is already stale AND we're not receiving updates
                setHasReceivedFreshGps(false);
                OverlayLogger.warn('GPS update is stale and no longer receiving updates - hiding location/weather', {
                  reportedAt: gpsUpdateTime,
                  timeSinceReportedAt: now - gpsUpdateTime,
                  wasReceivingUpdates: !wasGpsDataStale
                });
              } else if (timeUntilStale > 0 && wasGpsDataStale) {
                // Set timeout only if we're not actively receiving updates
                // If we start receiving updates again, the timeout will be cleared above
                const reportedAtForTimeout = gpsUpdateTime; // Capture for timeout callback
                locationWeatherHideTimeoutRef.current = setTimeout(() => {
                  // Double-check we're still not receiving updates before hiding
                  const timeSinceLastUpdate = Date.now() - lastGpsUpdateTime.current;
                  if (timeSinceLastUpdate > GPS_STALE_TIMEOUT) {
                    setHasReceivedFreshGps(false);
                    OverlayLogger.warn('GPS update is now stale (15+ minutes old) - hiding location/weather (data cached)', {
                      reportedAt: reportedAtForTimeout,
                      timeSinceReportedAt: Date.now() - reportedAtForTimeout
                    });
                  }
                }, timeUntilStale);
              }
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
                // Keep data even if GPS is stale initially
                OverlayLogger.warn('First GPS update is stale but data is still valid - keeping cached data');
              }
            }
            
            // Get previous coordinates for distance calculation
            const prevCoords = lastCoords.current;
            const prevTime = lastCoordsTime.current;
            
            // Calculate BOTH speeds and use the maximum for reliability
            let rtirlSpeed = 0;
            let calculatedSpeed = 0;
            
            // Get RTIRL's speed if available (preferred source)
            // BUT only trust it if GPS data was fresh (not stale before this update)
            if (typeof payload === 'object' && payload !== null && 'speed' in payload) {
              const rtirlPayload = payload as RTIRLPayload;
              if (typeof rtirlPayload.speed === 'number' && rtirlPayload.speed >= 0) {
                // Only use RTIRL speed if GPS data was fresh (not stale)
                // If GPS was stale, the speed might be stale too, so ignore it
                if (!wasGpsDataStale) {
                rtirlSpeed = rtirlPayload.speed;
                }
                // If GPS was stale, rtirlSpeed remains 0
              }
            }
            
            // Calculate speed from coordinates as fallback (RTIRL already filters by movement distance)
            // Since RTIRL sends updates every 10m of movement, we can trust RTIRL speed more
            if (prevCoords && prevTime > 0 && !wasGpsDataStale && rtirlSpeed === 0) {
              const movedMeters = distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]);
              const timeDiffSeconds = (now - prevTime) / 1000;
              const timeDiffHours = timeDiffSeconds / 3600;
              
              // Only calculate if we have meaningful movement and time difference
              // RTIRL already filters by movement distance, so we can be more lenient here
              const MIN_TIME_SECONDS = 1; // Minimum 1 second to prevent division issues
              
              if (timeDiffHours > 0 && timeDiffSeconds >= MIN_TIME_SECONDS && movedMeters > 0) {
                calculatedSpeed = (movedMeters / 1000) / timeDiffHours;
              }
            }
            
            // Prioritize RTIRL speed (it's already filtered by movement distance)
            // Use calculated speed only as fallback when RTIRL speed is not available
            // If GPS data was stale, ignore all speed values (set to 0)
            const speedKmh = wasGpsDataStale ? 0 : (rtirlSpeed > 0 ? rtirlSpeed : calculatedSpeed);
            const roundedSpeed = Math.round(speedKmh);
            
            // Log GPS updates for debugging (only in development, and not on every update to reduce spam)
            if (process.env.NODE_ENV === 'development' && (isFirstGpsUpdate || isFirstFreshGps)) {
              OverlayLogger.overlay('GPS update received', {
                fresh: isFresh,
                age: now - gpsUpdateTime,
                coordinates: [lat, lon],
                speed: roundedSpeed
              });
            }
            
            setCurrentSpeed(roundedSpeed);
            
            lastCoords.current = [lat!, lon!];
            lastCoordsTime.current = now;
            
            // Trigger minimap visibility update after GPS data is processed
            updateMinimapVisibilityRef.current();
            
            // Kick off location + weather fetches on coordinate updates with gating
            (async () => {
              const movedMeters = prevCoords ? distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]) : Infinity;

              // Adaptive location update threshold based on speed
              // High speed (flying): Update less frequently to save API calls
              // Medium speed (driving): Moderate updates
              // Low speed (walking): Frequent updates for accuracy
              const adaptiveLocationThreshold = currentSpeed > 200 
                ? 1000  // 1km threshold for flights (>200 km/h)
                : currentSpeed > 50 
                  ? 100  // 100m threshold for driving (50-200 km/h)
                  : THRESHOLDS.LOCATION_MOVEMENT_THRESHOLD; // 10m threshold for walking (<50 km/h)

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
              
              // Location updates: always on first load, or every minute if moved threshold
              // We need country name/flag even in custom location mode
              const shouldFetchLocation = lastLocationTime.current === 0 || 
                (locationElapsed >= DYNAMIC_TIMERS.UPDATE_INTERVAL && meetsDistance);
              
              // If settings just updated (hash changed), allow UI update but do not force API refetch here
              // API fetching remains purely based on the time/distance gates above

              // Fetch weather and location in parallel for faster loading
              // Fetch weather if GPS is fresh OR if it's the first update and GPS update is recent
              // This ensures weather/sunriseSunset are fetched even on initial load with recent data
              const promises: Promise<void>[] = [];
              
              // Fetch weather even if GPS is stale - we need timezone for overlay to show
              // Weather data will be cached and shown when GPS becomes fresh
              const shouldFetchWeatherNow = shouldFetchWeather && API_KEYS.OPENWEATHER && 
                !weatherFetchInProgress.current; // Prevent concurrent weather fetches
              
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
                        setWeather(result.weather);
                        lastSuccessfulWeatherFetch.current = Date.now(); // Track successful weather fetch
                      } else {
                        // Don't clear weather if fetch fails - keep existing weather data
                        OverlayLogger.warn('Weather result missing weather data');
                      }
                      
                      // OpenWeatherMap timezone is ONLY a fallback (less accurate than LocationIQ)
                      // Only use it if we're still on the UTC default and no other source has provided timezone
                      if (result.timezone && !isRealTimezone(timezone)) {
                        createDateTimeFormatters(result.timezone);
                        setTimezone(result.timezone);
                      }
                      
                      if (result.sunriseSunset) {
                        setSunriseSunset(result.sunriseSunset);
                        OverlayLogger.overlay('Sunrise/sunset data received', { sunriseSunset: result.sunriseSunset });
                      }
                    } else {
                      // OpenWeatherMap failed - don't clear existing weather, keep showing last known weather
                      // Only use fallback if we have no weather data at all
                      if (!weather) {
                        OverlayLogger.warn('OpenWeatherMap failed and no cached weather, using fallbacks');
                        const fallbackWeather = createWeatherFallback();
                        if (fallbackWeather) {
                          setWeather(fallbackWeather);
                          lastSuccessfulWeatherFetch.current = Date.now();
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
                      if (canMakeApiCall('locationiq')) {
                      trackApiCall('locationiq');
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
                        OverlayLogger.location('Location updated', {
                          mode: currentDisplayMode,
                          primary: formatted.primary.trim() || 'none',
                          country: formatted.country || 'none',
                          city: loc.city || loc.town || 'none',
                          neighbourhood: loc.neighbourhood || loc.suburb || 'none',
                          rawData: {
                            hasCity: !!loc.city,
                            hasNeighbourhood: !!loc.neighbourhood,
                            hasSuburb: !!loc.suburb
                          }
                        });
                        setLocation({
                            primary: formatted.primary.trim() || '', // Ensure no leading/trailing whitespace
                          country: formatted.country,
                          countryCode: loc.countryCode || ''
                        });
                        lastSuccessfulLocationFetch.current = Date.now(); // Track successful location fetch
                        setHasIncompleteLocationData(false); // Clear incomplete flag when we have good data
                      }
                      
                      // PRIORITY: LocationIQ timezone is ALWAYS preferred (accurate IANA timezone)
                      // This overrides OpenWeatherMap's less accurate offset-based timezone
                      if (loc.timezone) {
                        createDateTimeFormatters(loc.timezone);
                        setTimezone(loc.timezone);
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
                        setLocation({
                          primary: formattedCountryName,
                          country: undefined, // No country line needed when showing country as primary
                          countryCode: countryCode
                        });
                        lastSuccessfulLocationFetch.current = Date.now(); // Track successful location fetch
                      }
                      
                      // Use timezone if available
                      if (loc!.timezone) {
                        createDateTimeFormatters(loc!.timezone);
                        setTimezone(loc!.timezone);
                      }
                    } else if (!locationIQRateLimited) {
                      // LocationIQ failed completely (not rate-limited), use country-only fallback
                      // Never show coordinates - only show country if estimable, or ocean names if on water
                      OverlayLogger.warn('LocationIQ failed, using country-only fallback');
                      
                      const fallbackLocation = createLocationWithCountryFallback(lat!, lon!, locationIQWas404);
                      // Only update if we have something meaningful to show (country or ocean name)
                      // Don't show coordinates - show country if available, or nothing
                      if (fallbackLocation.country || (fallbackLocation.primary && fallbackLocation.primary.trim())) {
                        setLocation({
                          primary: fallbackLocation.primary.trim() || '', // Ocean name or empty
                          country: fallbackLocation.country, // Country name if estimable
                          countryCode: fallbackLocation.countryCode || ''
                        });
                        lastSuccessfulLocationFetch.current = Date.now(); // Track successful location fetch
                        setHasIncompleteLocationData(false); // Clear incomplete flag when we have fallback data
                      }
                      // If no country can be estimated and not on water, don't update location (keep existing or blank)
                    }
                    // If rate-limited, don't update location - keep existing location or wait for next update
                    // If fetch failed, don't clear location - keep showing last known location
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
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMakeApiCall, safeApiCall, timezone, trackApiCall]); // Functions are accessed via refs to avoid re-creating RTIRL listener

  // Overlay visibility - wait for all elements to be ready
  // Show overlay as soon as we have timezone (even if time hasn't formatted yet)
  // Time will appear once formatters are created
  const isOverlayReady = useMemo(() => {
    // Timezone must be ready (time will format once timezone is set)
    const timeReady = isRealTimezone(timezone);
    
    // Location is optional - overlay shows even without location (blank until loaded)
    // Only check if custom location is set when in custom mode
    const locationReady = settings.locationDisplay === 'hidden' || 
      settings.locationDisplay === 'custom' ? settings.customLocation?.trim() !== undefined : true;
    
    return timeReady && locationReady;
  }, [timezone, settings, isRealTimezone]);

  // Note: Timeout fallback removed since overlay now shows immediately when time/timezone are ready
  // Location and weather are optional and will appear when loaded

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      // Wait 0.5 seconds for all elements to be ready, then fade in
      const delay = setTimeout(() => setOverlayVisible(true), 500);
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);


  // Memoized display values
  const locationDisplay = useMemo(() => {
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      return {
        primary: settings.customLocation?.trim() || '',
        country: location?.country, // Show the actual country name
        countryCode: location?.countryCode?.toUpperCase()
      };
    }
    
    // Show location data if available
    // For 'country' mode, primary will be empty but country will have country data
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
  const isNightTime = useCallback((): boolean => {
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
  }, [timezone, sunriseSunset]);

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
    <ErrorBoundary>
      <div 
        className="overlay-container obs-render"
        style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.8s ease-in-out'
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
          {/* Hide entire right section until fresh GPS update (unless custom location mode)
              Also hide if we have incomplete location data (country but no country code)
              Data is cached so it appears immediately when GPS becomes fresh again */}
          {((settings.locationDisplay === 'custom') || (hasReceivedFreshGps && !hasIncompleteLocationData)) && (
            <>
          {settings.locationDisplay !== 'hidden' && (
          <div className="overlay-box">
            {/* Only show location when GPS is fresh (or custom mode) */}
            {((settings.locationDisplay === 'custom') || hasReceivedFreshGps) && locationDisplay && (
              <>
                  {locationDisplay.primary && (
                  <div className="location location-line">
                    <div className="location-main">{locationDisplay.primary}</div>
                  </div>
                  )}
                  {locationDisplay.country && (
                    // Only show country name/flag if:
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
