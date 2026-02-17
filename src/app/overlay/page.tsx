"use client";

// React imports
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Next.js imports
import dynamic from 'next/dynamic';

// Component imports
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Hook imports
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTodoCompletion } from '@/hooks/useTodoCompletion';
import { useRenderPerformance } from '@/lib/performance';

// Type imports
import type { RTIRLPayload } from '@/utils/overlay-constants';
import type { SunriseSunsetData } from '@/utils/api-utils';
import type { LocationData } from '@/utils/location-utils';

// Utility imports
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit, kmhToMph, metersToFeet } from '@/utils/unit-conversions';
import { API_KEYS, TIMERS, SPEED_ANIMATION, ELEVATION_ANIMATION } from '@/utils/overlay-constants';
import { formatLocation, formatCountryName, getLocationForPersistence } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ } from '@/utils/api-utils';
import { checkRateLimit, canMakeApiCall } from '@/utils/rate-limiting';
import { 
  createLocationWithCountryFallback, 
  createWeatherFallback, 
  createSunriseSunsetFallback,
  isNightTimeFallback
} from '@/utils/fallback-utils';
import { 
  clearTimer,
  safeApiCall,
  formatTimeUTC,
  formatTimeWithTimezone,
  isValidTimezone,
} from '@/utils/overlay-helpers';
import {
  hasCompleteLocationData,
  formatCountryCode,
  shouldShowDisplayMode,
  getEffectiveDisplayModeForStaleGps,
} from '@/utils/overlay-utils';
import {
  processGpsData,
  calculateSpeedFromPayload,
  processAltitude
} from '@/utils/rtirl-processor';
import {
  shouldFetchWeather,
  shouldFetchLocation,
  calculateMovedMeters
} from '@/utils/fetch-decision';
import {
  isSpeedStale,
  isAltitudeStale
} from '@/utils/staleness-utils';
import { useOverlaySettings } from '@/hooks/useOverlaySettings';
import { filterOptionForDisplay, filterTextForDisplay } from '@/lib/poll-content-filter';

// Extract constants for cleaner code
const {
  WALKING_PACE_THRESHOLD,
  MINIMAP_STALENESS_CHECK_INTERVAL,
  MINIMAP_HIDE_DELAY,
  GPS_STALE_TIMEOUT,
} = TIMERS;

// MapLibreMinimap component - WebGL-based map rendering
const MapLibreMinimap = dynamic(() => import('@/components/MapLibreMinimap'), {
  ssr: false,
  loading: () => <div className="minimap-placeholder" />
});

const HeartRateMonitor = dynamic(() => import('@/components/HeartRateMonitor'), {
  ssr: false,
  loading: () => null
});

// Flag component - simple SVG only, hidden until loaded to prevent alt text flash
const LocationFlag = ({ countryCode }: { countryCode: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  
  return (
    <span className="location-flag-inline">
      <img
        src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
        alt={`Country: ${countryCode}`}
        width={32}
        height={20}
        className="location-flag-small"
        style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(true)}
      />
    </span>
  );
};

function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // Version parameter is added server-side via middleware to prevent OBS caching
  // No client-side code needed - middleware handles it before the page loads

  // State
  const [timeDisplay, setTimeDisplay] = useState({ time: '', date: '' });
  const [location, setLocation] = useState<{ 
    primary: string; 
    secondary?: string;
    countryCode?: string;
  } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sunriseSunset, setSunriseSunset] = useState<SunriseSunsetData | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [currentAltitude, setCurrentAltitude] = useState<number | null>(null);
  const [settings, setSettings, settingsLoadedRef, refreshSettings] = useOverlaySettings();
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [minimapOpacity, setMinimapOpacity] = useState(1.0); // Fully opaque for better readability
  const [, setHasIncompleteLocationData] = useState(false); // Track if we have incomplete location data (country but no code)
  const [overlayVisible, setOverlayVisible] = useState(false); // Track if overlay should be visible (fade-in delay)
  
  // Todo completion tracking with localStorage persistence
  const visibleTodos = useTodoCompletion(settings.todos);


  // When active poll countdown ends: show winner immediately from current votes, then sync with server
  const pollCountdownRef = useRef<{ pollId: string } | null>(null);
  const latestPollRef = useRef<typeof settings.pollState>(null);
  const lastPollIdRef = useRef<string | null>(null);
  if (settings.pollState?.status === 'active') latestPollRef.current = settings.pollState;

  useEffect(() => {
    const poll = settings.pollState;
    if (poll?.status !== 'active') {
      pollCountdownRef.current = null;
      return;
    }
    const endsAt = poll.startedAt + poll.durationSeconds * 1000;
    const remainingMs = Math.max(0, endsAt - Date.now());
    if (pollCountdownRef.current?.pollId === poll.id) return; // already scheduled
    pollCountdownRef.current = { pollId: poll.id };
    const winnerDisplaySeconds = 10;
    const timeout = setTimeout(() => {
      pollCountdownRef.current = null;
      const current = latestPollRef.current;
      const totalVotes = current?.options?.reduce((s, o) => s + o.votes, 0) ?? 0;

      fetch('/api/poll-end-trigger', { cache: 'no-store' }).catch(() => {});

      if (current) {
        if (totalVotes > 0) {
          setSettings((prev) => ({
            ...prev,
            pollState: {
              ...current,
              status: 'winner',
              winnerDisplayUntil: Date.now() + winnerDisplaySeconds * 1000,
            },
          }));
          setTimeout(() => refreshSettings(), winnerDisplaySeconds * 1000);
        } else {
          lastPollIdRef.current = null;
          setSettings((prev) => ({ ...prev, pollState: null }));
          refreshSettings();
        }
      }
    }, remainingMs);
    return () => clearTimeout(timeout);
  }, [settings.pollState?.id, settings.pollState?.status, settings.pollState?.startedAt, settings.pollState?.durationSeconds, refreshSettings, setSettings]);

  // Re-render every second when showing winner so we hide when winnerDisplayUntil passes
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    const poll = settings.pollState;
    if (poll?.status === 'winner' && poll.winnerDisplayUntil != null && Date.now() < poll.winnerDisplayUntil) {
      const id = setInterval(() => setPollTick((n) => n + 1), 1000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [settings.pollState, pollTick]);

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastGpsUpdateTime = useRef(0); // Track when we last got GPS data (use ref for synchronous updates)
  const lastGpsTimestamp = useRef(0); // Track the actual GPS timestamp from payload (not reception time)
  const weatherFetchInProgress = useRef(false); // Track if weather fetch is already in progress
  const locationFetchInProgress = useRef(false);
  
  // Stats update throttling
  const lastStatsUpdateTime = useRef(0);
  const lastSentSpeed = useRef<number | null>(null);
  const lastSentAltitude = useRef<number | null>(null);
  const STATS_UPDATE_INTERVAL = 5000; // Send stats updates every 5 seconds max
  const SPEED_CHANGE_THRESHOLD = 2; // Only send if speed changed by 2+ km/h
  const ALTITUDE_CHANGE_THRESHOLD = 10; // Only send if altitude changed by 10+ meters // Track if location fetch is already in progress
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const lastRawLocation = useRef<LocationData | null>(null);
  const locationReceivedFromRtirlRef = useRef(false); // Prevents persistent fallback from overwriting RTIRL data
  const persistentFallbackTimerRef = useRef<NodeJS.Timeout | null>(null); // Cleared when RTIRL provides data
  const lastSuccessfulWeatherFetch = useRef(0); // Track when weather was last successfully fetched
  const lastSuccessfulLocationFetch = useRef(0); // Track when location was last successfully fetched
  
  // API rate limiting tracking (per-second only)
  // GPS update tracking for minimap
  const minimapFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track last 3 speed readings for minimap visibility (need 3 consecutive readings > 5 km/h)
  const speedReadingsRef = useRef<number[]>([]); // Array of last 3 speed readings
  
  // Minimap speed-based visibility tracking
  const lowSpeedStartTimeRef = useRef<number | null>(null); // Track when speed dropped below 5 km/h
  
  // Speed and altitude staleness tracking
  // Track GPS timestamps (from payload), not reception times, so staleness works when stationary
  const lastSpeedGpsTimestamp = useRef(0); // Track GPS timestamp when speed was last updated
  const lastAltitudeGpsTimestamp = useRef(0); // Track GPS timestamp when altitude was last updated
  const [speedUpdateTimestamp, setSpeedUpdateTimestamp] = useState(0); // State to trigger re-renders
  const [altitudeUpdateTimestamp, setAltitudeUpdateTimestamp] = useState(0); // State to trigger re-renders
  const [gpsTimestampForDisplay, setGpsTimestampForDisplay] = useState(0); // Triggers locationDisplay recalc when GPS freshness changes (ref alone doesn't re-render)

  // Ref to track current speed for minimap visibility (prevents infinite loops)
  const currentSpeedRef = useRef(0);


  
  // Simplified minimap visibility logic:
  // - Show: Speed > 5 km/h for 3 consecutive RTIRL updates
  // - Hide: Speed < 5 km/h for more than 1 minute OR no GPS updates in 1 minute
  const updateMinimapVisibility = useCallback(() => {
    const now = Date.now();
    const timeSinceLastGps = lastGpsUpdateTime.current > 0 ? (now - lastGpsUpdateTime.current) : Infinity;
    const isGpsStale = timeSinceLastGps > MINIMAP_HIDE_DELAY; // 1 minute without GPS updates
    
    clearTimer(minimapFadeTimeoutRef);
    
    // Use current speed state directly - ref updated inline when needed
    const speed = currentSpeed;
    
    if (settings.minimapSpeedBased) {
      // Check if GPS is stale (no updates in 1 minute) - hide after delay
      if (isGpsStale) {
        if (minimapVisible) {
          setMinimapVisible(false);
          setMinimapOpacity(0);
        }
        // Clear speed readings and low speed timer when GPS is stale
        speedReadingsRef.current = [];
        lowSpeedStartTimeRef.current = null;
        return;
      }
      
      // GPS is fresh - check speed readings
      // Check if we have 3 consecutive readings > 5 km/h
      const hasThreeHighSpeedReadings = speedReadingsRef.current.length >= 3 && 
        speedReadingsRef.current.every(s => s > WALKING_PACE_THRESHOLD);
      
      if (speed > WALKING_PACE_THRESHOLD) {
        // Speed > 5 km/h - show minimap if we have 3 consecutive readings > 5 km/h
        if (hasThreeHighSpeedReadings) {
          // Reset low speed timer since we're moving
          lowSpeedStartTimeRef.current = null;
          
          if (!minimapVisible) {
            setMinimapVisible(true);
            setMinimapOpacity(1.0);
          } else {
            setMinimapOpacity(1.0);
          }
        }
      } else {
        // Speed < 5 km/h - start timer, hide after 1 minute
        if (minimapVisible) {
          // Start tracking when speed dropped below threshold
          if (lowSpeedStartTimeRef.current === null) {
            lowSpeedStartTimeRef.current = now;
          }
          
          // Check if 1 minute has passed since speed dropped
          const timeSinceLowSpeed = now - lowSpeedStartTimeRef.current;
          if (timeSinceLowSpeed >= MINIMAP_HIDE_DELAY) {
          setMinimapVisible(false);
          setMinimapOpacity(0);
            speedReadingsRef.current = [];
            lowSpeedStartTimeRef.current = null;
          }
        } else {
          // Already hidden - clear readings and timer
          speedReadingsRef.current = [];
          lowSpeedStartTimeRef.current = null;
        }
      }
    } else if (settings.showMinimap) {
      // Manual show mode
      lowSpeedStartTimeRef.current = null; // Clear low speed timer in manual mode
      if (!minimapVisible) {
        setMinimapVisible(true);
        setMinimapOpacity(0);
        requestAnimationFrame(() => setMinimapOpacity(1.0));
      } else {
        setMinimapOpacity(1.0);
      }
    } else {
      // Manual hide mode (showMinimap is false and minimapSpeedBased is false)
      // Hide immediately when manually turned off (no fade delay)
      speedReadingsRef.current = [];
      lowSpeedStartTimeRef.current = null;
      if (minimapVisible) {
        setMinimapVisible(false);
        setMinimapOpacity(0);
        // Clear any pending fade timeout
        clearTimer(minimapFadeTimeoutRef);
      }
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, minimapVisible, currentSpeed]);

  // Track the last locationDisplay value to detect actual changes
  const lastLocationDisplayRef = useRef<string | undefined>(undefined);

  // Re-format location when locationDisplay changes
  useEffect(() => {
    const locationDisplayChanged = settings.locationDisplay !== lastLocationDisplayRef.current;
    lastLocationDisplayRef.current = settings.locationDisplay;

    // Only re-format location when locationDisplay actually changes
    // Other settings changes (showWeather, showMinimap, etc.) don't need location re-formatting
    if (!locationDisplayChanged) {
      return; // Skip re-formatting if locationDisplay hasn't changed
    }

    // Re-render location display instantly from cached raw data if available
    // This ensures location display updates immediately when settings change
    // IMPORTANT: Only re-format if we have complete location data (not just country)
    // This prevents trying to format incomplete fallback data
    const hasCompleteData = hasCompleteLocationData(lastRawLocation.current);
    
    // Re-format location when locationDisplay changes if we have complete location data
    if (hasCompleteData && settings.locationDisplay !== 'hidden') {
      try {
        const formatted = formatLocation(lastRawLocation.current!, settings.locationDisplay);
        // Log only when locationDisplay actually changes (reduced verbosity)
        // Force update location state to trigger re-render with new format
        setLocation({
          primary: formatted.primary || '',
          secondary: formatted.secondary,
          countryCode: lastRawLocation.current!.countryCode || ''
        });
        setHasIncompleteLocationData(false); // Clear incomplete flag when re-formatting
      } catch (error) {
        OverlayLogger.warn('Location re-formatting failed on settings change', { error });
        // Ignore formatting errors; UI will update on next normal cycle
      }
    } else if (locationDisplayChanged && !hasCompleteData && settingsLoadedRef.current) {
      // Only log if settings have been loaded (not initial default state)
      // Log when locationDisplay changes but we don't have complete location data yet
      if (lastRawLocation.current) {
        OverlayLogger.location('Location display mode changed but no complete location data available yet', {
          mode: settings.locationDisplay
        });
      } else {
        OverlayLogger.location('Location display mode changed but no raw location data cached yet', {
          mode: settings.locationDisplay
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settingsLoadedRef is stable, only locationDisplay matters
  }, [settings.locationDisplay]);

  // Combined minimap visibility updates - simpler than multiple separate effects
  useEffect(() => {
    try {
      // Clear speed readings and timers when switching modes or disabling minimap
      if (!settings.minimapSpeedBased) {
        speedReadingsRef.current = [];
        lowSpeedStartTimeRef.current = null;
      }
      updateMinimapVisibility();
    } catch (error) {
      OverlayLogger.error('Failed to update minimap visibility', error);
      // Don't throw - allow overlay to continue functioning
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, updateMinimapVisibility]);

  // Periodic check for GPS staleness (speed-based mode only)
  useEffect(() => {
    if (!settings.minimapSpeedBased) return;

    const interval = setInterval(() => {
      try {
        updateMinimapVisibility();
      } catch (error) {
        OverlayLogger.error('Failed to update minimap visibility in staleness check', error);
      }
    }, MINIMAP_STALENESS_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [settings.minimapSpeedBased, updateMinimapVisibility]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimer(minimapFadeTimeoutRef);
    };
  }, []);




  // Rate limiting is handled by checkRateLimit() from rate-limiting.ts
  // This ensures both per-second (1/sec) and daily (5,000/day) limits are enforced




  

  // Refs
  const timeUpdateTimer = useRef<NodeJS.Timeout | null>(null);

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


  // Helper function to format time/date using timezone
  const formatTime = useCallback((tz: string | null): { time: string; date: string } => {
    if (!isValidTimezone(tz)) {
      return { time: '', date: '' };
    }
    
    // TypeScript: tz is guaranteed to be string here due to isValidTimezone check
    const timezone = tz as string;
    
    try {
      return formatTimeWithTimezone(timezone);
    } catch (error) {
      OverlayLogger.warn('Invalid timezone format, using UTC fallback', { timezone: tz, error });
      return formatTimeUTC();
    }
  }, []);

  // Helper functions to update data - always update (no GPS staleness check)
  // Visibility is controlled by "Hidden" option in location display mode
  const updateLocation = useCallback((locationData: { primary: string; secondary?: string; countryCode?: string }) => {
    setLocation(locationData);
    lastSuccessfulLocationFetch.current = Date.now();
  }, []);

  const updateWeather = useCallback((weatherData: { temp: number; desc: string }) => {
    setWeather(weatherData);
    lastSuccessfulWeatherFetch.current = Date.now();
  }, []);

  // Single function to update timezone - used by all sources (LocationIQ, OpenWeatherMap, RTIRL)
  // Timezone updates even when GPS is stale - we need accurate timezone for time display
  const updateTimezone = useCallback((timezoneData: string) => {
    if (!isValidTimezone(timezoneData)) {
      return; // Don't set invalid timezones
    }
    setTimezone(timezoneData);
    // Don't call markGpsReceived() here - timezone updates even when GPS is stale
    // Location/weather visibility is controlled separately by hasReceivedFreshGps
  }, []);

  // Extract GPS timestamp from RTIRL payload (still needed for some edge cases)
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
  
  // Time and date updates - simplified single useEffect
  // Updates immediately when timezone changes, then every minute
  useEffect(() => {
    if (!isValidTimezone(timezone)) {
      setTimeDisplay({ time: '', date: '' });
      return;
    }
    
    let isActive = true;
    
    // Update function - formats time using current timezone
    const updateTime = () => {
      if (!isActive) return;
      const formatted = formatTime(timezone);
      if (isActive) {
        setTimeDisplay(formatted);
        }
    };
    
    // Immediate update when timezone changes
    updateTime();
      
    // Calculate delay until next minute boundary for clean updates
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
    // Schedule first update at minute boundary, then every minute
    const timeoutId = setTimeout(() => {
        if (!isActive) return;
      updateTime();
      // Start interval for regular updates
      timeUpdateTimer.current = setInterval(updateTime, 60000);
      }, Math.max(0, msUntilNextMinute));
    
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      if (timeUpdateTimer.current) {
        clearInterval(timeUpdateTimer.current);
        timeUpdateTimer.current = null;
      }
    };
  }, [timezone, formatTime]);

  // Persistent storage fallback - load from KV if RTIRL doesn't provide data within 15s
  useEffect(() => {
    const PERSISTENT_FALLBACK_DELAY = 15000;
    const loadFromPersistentFallback = async () => {
      if (locationReceivedFromRtirlRef.current) {
        OverlayLogger.location('Skipping persistent fallback - already have RTIRL data');
        return;
      }
      try {
        OverlayLogger.location('Loading from persistent storage (RTIRL fallback)', { reason: 'no RTIRL data received' });
        const res = await fetch('/api/get-location', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.location && data.rawLocation) {
            if (locationReceivedFromRtirlRef.current) return;
            setLocation(data.location);
            lastRawLocation.current = data.rawLocation;
            setHasIncompleteLocationData(false);
            if (process.env.NODE_ENV !== 'production') {
              OverlayLogger.location('Location from persistent storage (RTIRL unavailable)', {
                primary: data.location.primary || 'none',
                secondary: data.location.secondary || 'none'
              });
            }
          } else {
            OverlayLogger.location('Persistent storage empty - waiting for RTIRL');
          }
        } else {
          OverlayLogger.warn('Persistent location fetch failed', { status: res.status });
        }
      } catch (error) {
        OverlayLogger.warn('Failed to load from persistent storage', { error });
      }
    };
    persistentFallbackTimerRef.current = setTimeout(loadFromPersistentFallback, PERSISTENT_FALLBACK_DELAY);
    OverlayLogger.location('Waiting for RTIRL data', { fallbackIn: `${PERSISTENT_FALLBACK_DELAY / 1000}s if no data` });
    return () => {
      if (persistentFallbackTimerRef.current) {
        clearTimeout(persistentFallbackTimerRef.current);
        persistentFallbackTimerRef.current = null;
      }
    };
  }, []);

  // RTIRL connection - use refs to avoid re-running on timezone/settings changes
  const timezoneRef = useRef(timezone);
  const updateMinimapVisibilityRef = useRef(updateMinimapVisibility);
  const settingsRef = useRef(settings);
  const updateTimezoneRef = useRef(updateTimezone);
  
  // Update refs when values change (needed for RTIRL listener closure)
  useEffect(() => {
    timezoneRef.current = timezone;
    updateMinimapVisibilityRef.current = updateMinimapVisibility;
    settingsRef.current = settings;
    updateTimezoneRef.current = updateTimezone;
  }, [timezone, updateMinimapVisibility, settings, updateTimezone]);




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
              
              // Process GPS data using utility function
              const gpsData = processGpsData(
                payload,
                lastGpsUpdateTime.current,
                lastGpsTimestamp.current,
                lastCoords.current
              );
              
              if (!gpsData) return;
              
              const { coords, payloadTimestamp, now, isPayloadFresh, wasGpsDataStale, prevCoords, prevGpsTimestamp } = gpsData;
              const [lat, lon] = coords;
              
              setMapCoords(coords);
              
              // Log RTIRL payload for debugging (essential info only)
              if (process.env.NODE_ENV !== 'production') {
                OverlayLogger.overlay('RTIRL update received', {
                  coordinates: { lat, lon },
                  speed: payload.speed || 0,
                  altitude: payload.altitude !== undefined ? payload.altitude : 'not provided',
                  timestamp: payloadTimestamp,
                  timestampAge: Math.round((now - payloadTimestamp) / 1000),
                  timestampAgeMinutes: Math.round((now - payloadTimestamp) / 60000),
                  isFresh: isPayloadFresh,
                  reportedAt: (payload as { reportedAt?: number }).reportedAt,
                  updatedAt: (payload as { updatedAt?: number }).updatedAt
                });
              }
              
              // Handle timezone from RTIRL (lowest priority - will be overridden by LocationIQ/OpenWeatherMap)
              if (payload.location?.timezone) {
                updateTimezoneRef.current(payload.location.timezone);
              }
              
              // Update GPS timestamps AFTER checking for staleness
              lastGpsUpdateTime.current = now;
              lastGpsTimestamp.current = payloadTimestamp;
              setGpsTimestampForDisplay(payloadTimestamp); // Trigger locationDisplay recalc (fresh→show neighbourhood from saved data, no API call)
              
              // Calculate speed using utility function
              const speedKmh = calculateSpeedFromPayload(
                payload,
                lat,
                lon,
                prevCoords,
                prevGpsTimestamp,
                payloadTimestamp,
                wasGpsDataStale
              );
              const roundedSpeed = Math.round(speedKmh);
              
              setCurrentSpeed(roundedSpeed);
              currentSpeedRef.current = roundedSpeed;
              lastSpeedGpsTimestamp.current = payloadTimestamp;
              setSpeedUpdateTimestamp(now);
              
              // Process altitude using utility function
              const roundedAltitude = processAltitude(payload);
              if (roundedAltitude !== null) {
                setCurrentAltitude(roundedAltitude);
                lastAltitudeGpsTimestamp.current = payloadTimestamp;
                setAltitudeUpdateTimestamp(now);
              }

              // Send stats updates (throttled)
              const timeSinceLastUpdate = now - lastStatsUpdateTime.current;
              const shouldUpdate = timeSinceLastUpdate >= STATS_UPDATE_INTERVAL;
              const speedChanged = lastSentSpeed.current === null || Math.abs(roundedSpeed - lastSentSpeed.current) >= SPEED_CHANGE_THRESHOLD;
              const altitudeChanged = roundedAltitude !== null && (lastSentAltitude.current === null || Math.abs(roundedAltitude - lastSentAltitude.current) >= ALTITUDE_CHANGE_THRESHOLD);

              if (shouldUpdate && (speedChanged || altitudeChanged)) {
                lastStatsUpdateTime.current = now;
                
                const statsPayload: Record<string, unknown> = {};
                
                if (speedChanged) {
                  statsPayload.speed = { speed: roundedSpeed, timestamp: payloadTimestamp };
                  lastSentSpeed.current = roundedSpeed;
                }
                
                if (altitudeChanged && roundedAltitude !== null) {
                  statsPayload.altitude = { altitude: roundedAltitude, timestamp: payloadTimestamp };
                  lastSentAltitude.current = roundedAltitude;
                }

                // Send stats update (fire and forget)
                fetch('/api/stats/update', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(statsPayload),
                }).catch(() => {
                  // Silently fail - stats are optional
                });
              }
              
              // Track speed readings for minimap visibility (need 3 consecutive readings > 5 km/h)
              if (settingsRef.current.minimapSpeedBased) {
                speedReadingsRef.current.push(roundedSpeed);
                // Keep only last 3 readings
                if (speedReadingsRef.current.length > 3) {
                  speedReadingsRef.current.shift(); // Remove oldest reading
                }
                // Reset low speed timer when we get a new GPS update (GPS is fresh)
                if (roundedSpeed > WALKING_PACE_THRESHOLD) {
                  lowSpeedStartTimeRef.current = null;
                }
              }
              
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
              
              // Only fetch location/weather if GPS is fresh - don't fetch when stale
              // Timezone will still be updated from RTIRL even when GPS is stale
              // But we still need to allow timezone updates from RTIRL, so don't return early
              // Instead, check isFresh before fetching location/weather below
              
              // Kick off location + weather fetches on coordinate updates with gating
              (async () => {
                // Calculate distance moved
                const movedMeters = calculateMovedMeters(prevCoords, coords);
              
              // Determine fetch decisions using utility functions
              const needsTimezone = !isValidTimezone(timezoneRef.current);
              const weatherDecision = shouldFetchWeather({
                now,
                lastFetchTime: lastWeatherTime.current,
                lastSuccessfulFetch: lastSuccessfulWeatherFetch.current,
                movedMeters,
                prevCoords,
                currentCoords: coords,
                currentSpeed: roundedSpeed,
                needsTimezone,
              });
              
              const locationDecision = shouldFetchLocation({
                now,
                lastFetchTime: lastLocationTime.current,
                lastSuccessfulFetch: lastSuccessfulLocationFetch.current,
                movedMeters,
                prevCoords,
                currentCoords: coords,
                currentSpeed: roundedSpeed,
                needsTimezone: false,
              });
              
              // Fetch weather and location in parallel for faster loading
              const promises: Promise<void>[] = [];
              
              // Check if weather should actually be fetched (with rate limiting and concurrency checks)
              // Dramatic changes (>50km) bypass rate limiting (e.g., airplane GPS reconnects)
              const shouldFetchWeatherNow = weatherDecision.shouldFetch && 
                API_KEYS.OPENWEATHER && 
                !weatherFetchInProgress.current &&
                (weatherDecision.isDramaticChange || checkRateLimit('openweathermap'));
              
              // Log weather fetch decision for debugging
              if (weatherDecision.shouldFetch && API_KEYS.OPENWEATHER) {
                const reason = shouldFetchWeatherNow
                  ? (weatherDecision.isDramaticChange ? 'dramatic change' : weatherDecision.reason)
                  : (!canMakeApiCall('openweathermap') ? 'rate limited' :
                     weatherFetchInProgress.current ? 'fetch in progress' : weatherDecision.reason);
                OverlayLogger.weather('Weather fetch check', {
                  willFetch: shouldFetchWeatherNow,
                  reason,
                  needsTimezone,
                });
              }
              
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
                      
                      // Always update weather state when available (no GPS staleness check)
                      if (result.weather) {
                        updateWeather(result.weather);
                      } else {
                        OverlayLogger.warn('Weather result missing weather data');
                      }
                      
                      // OpenWeatherMap timezone: Always update timezone even if GPS is stale
                      // LocationIQ will override with more accurate timezone if available
                      // This ensures timezone updates when moving to new locations and time/date display works
                      if (result.timezone) {
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
              
              // Check if location should actually be fetched (with concurrency check)
              // Dramatic changes (>50km) bypass rate limiting (e.g., airplane GPS reconnects)
              const shouldFetchLocationNow = locationDecision.shouldFetch && 
                !locationFetchInProgress.current &&
                (locationDecision.isDramaticChange || checkRateLimit('locationiq'));
              
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
                    const locationIQRateLimited = false;
                    
                    if (API_KEYS.LOCATIONIQ) {
                      // Rate limit already checked above (line 972) - don't check again to avoid double consumption
                      // The checkRateLimit call above already consumed a quota slot
                      const locationResult = await safeApiCall(
                        () => fetchLocationFromLocationIQ(lat!, lon!, API_KEYS.LOCATIONIQ!),
                        'LocationIQ fetch'
                      );
                      if (locationResult && typeof locationResult === 'object' && 'location' in locationResult) {
                        const result = locationResult as { location: LocationData | null; was404: boolean };
                        loc = result.location;
                        locationIQWas404 = result.was404;
                      }
                    }
                    
                    // Only update if this is still the most recent request
                    // Prevents race conditions where older requests complete after newer ones
                    if (requestTimestamp >= lastLocationTime.current) {
                      lastLocationTime.current = requestTimestamp;

                      // Check if LocationIQ returned useful data (more than just country)
                      const hasUsefulData = hasCompleteLocationData(loc);
                    
                    const hasCountryData = loc && loc.country;
                    
                    if (loc && hasUsefulData) {
                      // Full location data available - use it
                      // Use settingsRef to get the current settings value (not stale closure value)
                      const currentDisplayMode = settingsRef.current.locationDisplay;
                      const formatted = formatLocation(loc, currentDisplayMode);
                      lastRawLocation.current = loc;
                      locationReceivedFromRtirlRef.current = true;
                      if (persistentFallbackTimerRef.current) {
                        clearTimeout(persistentFallbackTimerRef.current);
                        persistentFallbackTimerRef.current = null;
                      }
                      
                      // Update persistent location storage (for chat commands) via API - KV vars are server-only
                      // Store neighbourhood, city, state, country etc. so admin display mode (state/city/neighbourhood) works
                      const payloadTimestamp = extractGpsTimestamp(payload);
                      const locationToStore = getLocationForPersistence(loc);
                      const persistentPayload = locationToStore ? {
                        location: locationToStore,
                        rtirl: { lat: lat!, lon: lon!, raw: payload, updatedAt: payloadTimestamp || Date.now() },
                        updatedAt: Date.now(),
                      } : null;
                      if (persistentPayload) {
                        fetch('/api/update-location', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(persistentPayload),
                        })
                          .then(res => {
                            if (res.ok && process.env.NODE_ENV !== 'production' && persistentPayload) {
                              const loc = persistentPayload.location;
                              OverlayLogger.location('Persistent location saved for chat commands', {
                                stored: {
                                  neighbourhood: loc.neighbourhood || '–',
                                  city: loc.city || '–',
                                  state: loc.state || '–',
                                  country: loc.country || '–'
                                }
                              });
                            } else if (!res.ok) {
                              OverlayLogger.warn('Persistent location save failed', { status: res.status });
                            }
                          })
                          .catch(() => {
                            // Silently fail - persistent storage is optional
                          });
                      }
                      
                      // Only update if we have something meaningful to display
                        // Check for non-empty strings (not just truthy, since empty string is falsy)
                        if (formatted.primary.trim() || formatted.secondary) {
                        if (process.env.NODE_ENV !== 'production') {
                          OverlayLogger.location('Location from RTIRL+LocationIQ', {
                            mode: currentDisplayMode,
                            primary: formatted.primary.trim() || 'none',
                            secondary: formatted.secondary || 'none'
                          });
                        }
                        updateLocation({
                          primary: formatted.primary.trim() || '',
                          secondary: formatted.secondary,
                          countryCode: loc.countryCode || ''
                        });
                        setHasIncompleteLocationData(false);
                      }
                      
                      // PRIORITY: LocationIQ timezone is ALWAYS preferred (accurate IANA timezone)
                      // Always update timezone from LocationIQ when available, even if we already have one
                      // This ensures timezone updates correctly when moving between locations
                      if (loc.timezone) {
                        if (process.env.NODE_ENV !== 'production') {
                          OverlayLogger.location('Updating timezone from LocationIQ', { 
                            timezone: loc.timezone,
                            previousTimezone: timezoneRef.current 
                          });
                        }
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
                          secondary: undefined,
                          countryCode: countryCode
                        });
                        // Persist country-only for chat commands when admin sets country display mode
                        const countryOnlyLocation = getLocationForPersistence({ country: rawCountryName, countryCode, timezone: loc!.timezone });
                        if (countryOnlyLocation) {
                          const payloadTimestamp = extractGpsTimestamp(payload);
                          fetch('/api/update-location', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              location: countryOnlyLocation,
                              rtirl: { lat: lat!, lon: lon!, raw: payload, updatedAt: payloadTimestamp || Date.now() },
                              updatedAt: Date.now(),
                            }),
                          }).catch(() => {});
                        }
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
                      if (fallbackLocation.secondary || (fallbackLocation.primary && fallbackLocation.primary.trim())) {
                        updateLocation({
                          primary: fallbackLocation.primary.trim() || '',
                          secondary: fallbackLocation.secondary,
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
    // Note: Deps intentionally empty - listener set up once, uses refs for latest values
    return () => {
      rtirlListenerSetupRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- RTIRL listener set up once on mount
  }, []);

  // Fade-in delay: Start overlay hidden, then fade in after 2 seconds to allow everything to load
  useEffect(() => {
    const fadeInTimer = setTimeout(() => {
      setOverlayVisible(true);
    }, 2000); // 2 second delay before fade-in to allow flags, images, and data to load

    return () => {
      clearTimeout(fadeInTimer);
    };
  }, []); // Run once on mount

  // Force periodic recalculation of location display (staleness) and day/night - update every minute
  const [staleCheckTime, setStaleCheckTime] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setStaleCheckTime(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Force periodic staleness check for speed indicator (auto mode) - when no RTIRL updates,
  // the useMemo would never re-run; this ensures we hide after GPS_STALE_TIMEOUT
  const [speedStaleCheckTime, setSpeedStaleCheckTime] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setSpeedStaleCheckTime(Date.now()), GPS_STALE_TIMEOUT);
    return () => clearInterval(interval);
  }, []);

  // Memoized display values
  // IMPORTANT: This memo re-formats location from raw data when settings change
  // Broaden display when GPS is stale (e.g. underground - neighbourhood→city→state→country)
  const locationDisplay = useMemo(() => {
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      return {
        primary: settings.customLocation?.trim() || '',
        secondary: location?.secondary, // Secondary line (city/state/country) - in custom mode this shows the actual country name
        countryCode: formatCountryCode(location?.countryCode)
      };
    }
    
    // If we have raw location data, re-format it with current settings to ensure display mode changes are reflected immediately
    // Broaden display when GPS is stale (e.g. underground train through many neighbourhoods)
    if (hasCompleteLocationData(lastRawLocation.current)) {
      try {
        const gpsAgeMs = lastGpsTimestamp.current > 0 ? Date.now() - lastGpsTimestamp.current : 0;
        const effectiveMode = getEffectiveDisplayModeForStaleGps(settings.locationDisplay, gpsAgeMs);
        const formatted = formatLocation(lastRawLocation.current, effectiveMode);
        return {
          primary: formatted.primary || '',
          secondary: formatted.secondary,
          countryCode: formatCountryCode(formatted.countryCode)
        };
      } catch (error) {
        // If formatting fails, fall back to location state
        OverlayLogger.warn('Location formatting failed in memo, using location state', { error });
      }
    }
    
    // Fallback to location state if no raw data or formatting failed
    // Show location data if available
    // For 'country' mode, primary will be empty but secondary field will have the country name
    if (location && (location.primary || location.secondary)) {
      return {
        ...location,
        countryCode: formatCountryCode(location.countryCode)
      };
    }
    
    // No location data yet - return null so UI stays blank
    return null;
  }, [location, settings.locationDisplay, settings.customLocation, staleCheckTime, gpsTimestampForDisplay]); // eslint-disable-line react-hooks/exhaustive-deps -- staleCheckTime + gpsTimestampForDisplay force recalc when staleness changes

  // Accurate day/night check using OpenWeatherMap sunrise/sunset data
  // Recalculates when sunriseSunset, timezone, or staleCheckTime changes
  const isNightTime = useMemo((): boolean => {
    if (!sunriseSunset) {
      // Wait for location data before computing day/night
      // If no timezone either, we're still loading - assume day until data arrives
      if (!timezone) return false;
      // Have timezone but no sunrise/sunset (API edge case) - use timezone-based fallback
      return isNightTimeFallback(timezone);
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
  }, [sunriseSunset, timezone, staleCheckTime]); // eslint-disable-line react-hooks/exhaustive-deps -- staleCheckTime forces periodic re-check

  // Get weather icon based on description and time of day
  // Returns emoji string
  const getWeatherIcon = useCallback((desc: string, showForAllConditions: boolean = false, isNight: boolean = false): string | null => {
    const d = desc.toLowerCase();
    
    // Hide icon for clear/partly cloudy conditions unless showing all conditions
    if (!showForAllConditions && (d.includes('clear') || d.includes('sunny') || d.includes('partly') || d.includes('few clouds'))) {
      return null;
    }
    
    // Map conditions to emojis with day/night variants
    if (d.includes('clear') || d.includes('sunny')) {
      return isNight ? '🌙' : '☀️';
    }
    if (d.includes('rain') || d.includes('drizzle')) {
      return '🌧️';
    }
    if (d.includes('storm') || d.includes('thunder')) {
      return '⛈️';
    }
    if (d.includes('snow')) {
      return '❄️';
    }
    if (d.includes('fog') || d.includes('mist') || d.includes('haze')) {
      return '🌫️';
    }
    if (d.includes('wind')) {
      return '💨';
    }
    if (d.includes('cloud') || d.includes('partly') || d.includes('few clouds')) {
      // Partly cloudy: sun behind cloud during day, just cloud at night (no single moon+cloud emoji)
      if (d.includes('partly') || d.includes('few clouds')) {
        return isNight ? '☁️' : '⛅';
      }
      return '☁️'; // Full clouds
    }
    
    // Default fallback
    return isNight ? '🌙' : '☀️';
  }, []);

  // Check if weather condition is notable (affects IRL streaming)
  const isNotableWeatherCondition = useCallback((desc: string): boolean => {
    const d = desc.toLowerCase();
    
    // Notable conditions that affect IRL streaming
    return (
      d.includes('rain') ||
      d.includes('drizzle') ||
      d.includes('storm') ||
      d.includes('thunder') ||
      d.includes('snow') ||
      d.includes('sleet') ||
      d.includes('hail') ||
      d.includes('fog') ||
      d.includes('mist') ||
      d.includes('haze') ||
      d.includes('wind') ||
      d.includes('gale') ||
      d.includes('hurricane') ||
      d.includes('typhoon') ||
      d.includes('tornado') ||
      d.includes('blizzard') ||
      d.includes('freezing') ||
      d.includes('extreme')
    );
  }, []);

  const weatherDisplay = useMemo(() => {
    if (!weather) {
    // No weather data - return null (no logging to reduce console spam)
    return null;
    }
    
    // Determine if icon and description should be shown based on display mode
    let showIcon = false;
    let showDescription = false;
    
    if (settings.weatherConditionDisplay === 'always') {
      // Always show icon and description
      showIcon = true;
      showDescription = true;
    } else if (settings.weatherConditionDisplay === 'auto') {
      // Only show for notable conditions
      const isNotable = isNotableWeatherCondition(weather.desc);
      showIcon = isNotable;
      showDescription = isNotable;
    }
    // 'hidden' mode: showIcon and showDescription remain false
    
    const icon = showIcon ? getWeatherIcon(weather.desc, settings.weatherConditionDisplay === 'always', isNightTime) : null;
    const description = showDescription ? weather.desc : null;
    
    const display = {
      temperature: `${weather.temp}°C (${celsiusToFahrenheit(weather.temp)}°F)`,
      icon: icon,
      description: description
    };
    return display;
  }, [weather, settings.weatherConditionDisplay, getWeatherIcon, isNotableWeatherCondition, isNightTime]);

  // Animated speed value - counts through each integer (50, 51, 52...) - faster for responsiveness
  const displayedSpeed = useAnimatedValue(currentSpeed, {
    ...SPEED_ANIMATION,
    allowNull: false,
  }) ?? 0;

  // Animated altitude value - counts through each integer (100, 101, 102...) - slower, more contemplative
  const displayedAltitude = useAnimatedValue(currentAltitude, {
    ...ELEVATION_ANIMATION,
    allowNull: true,
  });

  // Altitude display logic - hybrid change + rate detection for notable elevation
  const altitudeDisplay = useMemo(() => {
    // Hide if no altitude data
    if (currentAltitude === null || displayedAltitude === null) {
      return null;
    }
    
    // Check display mode first
    if (settings.altitudeDisplay === 'hidden') {
      return null;
    }
    
    // "Always" mode: show regardless of staleness or notable changes
    if (settings.altitudeDisplay === 'always') {
      const altitudeM = displayedAltitude;
      const altitudeFt = metersToFeet(altitudeM);
      return { value: altitudeM, formatted: `${altitudeM.toLocaleString()} m (${altitudeFt.toLocaleString()} ft)` };
    }
    
    // "Auto" mode: show only when above notable elevation threshold (e.g., mountains/hills)
    if (settings.altitudeDisplay === 'auto') {
      const altitudeIsStale = isAltitudeStale(lastAltitudeGpsTimestamp.current);
      const ELEVATION_THRESHOLD = 500; // meters
      const meetsElevationThreshold = currentAltitude >= ELEVATION_THRESHOLD;
      
      if (!shouldShowDisplayMode('auto', altitudeIsStale, meetsElevationThreshold)) {
        return null;
      }
    }
    
    // Show altitude (auto mode with notable change detected)
    const altitudeM = displayedAltitude;
    const altitudeFt = metersToFeet(altitudeM);
    return { value: altitudeM, formatted: `${altitudeM.toLocaleString()} m (${altitudeFt.toLocaleString()} ft)` };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- altitudeUpdateTimestamp forces re-run when altitude changes
  }, [currentAltitude, displayedAltitude, settings.altitudeDisplay, altitudeUpdateTimestamp]);

  // Speed display logic
  const speedDisplay = useMemo(() => {
    // Check display mode first
    if (settings.speedDisplay === 'hidden') {
      return null;
    }
    
    // Check staleness only for "auto" mode - "always" mode shows even if stale
    if (settings.speedDisplay === 'auto') {
      const speedIsStale = isSpeedStale(lastSpeedGpsTimestamp.current);
      const meetsSpeedThreshold = currentSpeed >= 10;
      
      if (!shouldShowDisplayMode('auto', speedIsStale, meetsSpeedThreshold)) {
        return null;
      }
    }
    
    // Show speed (either always mode, or auto mode with speed >= 10 km/h)
    // In always mode, show even if speed is 0
    const speedKmh = displayedSpeed;
    const speedMph = kmhToMph(speedKmh);
    return { value: speedKmh, formatted: `${Math.round(speedKmh)} km/h (${Math.round(speedMph)} mph)` };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- speedUpdateTimestamp + speedStaleCheckTime force re-run (latter for when no RTIRL updates)
  }, [currentSpeed, displayedSpeed, settings.speedDisplay, speedUpdateTimestamp, speedStaleCheckTime]);

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
            {/* Only show time when we have a valid timezone (not UTC) */}
            {isValidTimezone(timezone) && timeDisplay.time && (
              <div className="time time-left time-line">
                <div className="time-display">
                  <span className="time-value">{timeDisplay.time.split(' ')[0]}</span>
                  <span className="time-period">{timeDisplay.time.split(' ')[1]}</span>
                </div>
              </div>
            )}

            {/* Only show date when we have a valid timezone (not UTC) */}
            {isValidTimezone(timezone) && timeDisplay.date && (
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
              2. Location display is not 'hidden' AND we have valid data (location or weather) and no incomplete location data
              "Hidden" mode hides both location and weather (useful for flights, etc.) */}
          {settings.locationDisplay !== 'hidden' && (
            <>
          <div className="overlay-box">
            {/* Show location if we have location data (or custom mode) */}
            {((settings.locationDisplay === 'custom') || locationDisplay) && locationDisplay && (
              <>
                  {locationDisplay.primary && (
                  <div className="location location-line">
                    <div className="location-main">{locationDisplay.primary}</div>
                  </div>
                  )}
                  {locationDisplay.secondary && (
                    // Only show secondary line (city/state/country) with flag if:
                    // 1. Not in custom mode (always show for GPS modes), OR
                    // 2. In custom mode AND showCountryName is enabled
                    (settings.locationDisplay !== 'custom' || settings.showCountryName) && (
                    <div className={`location location-line location-sub-line ${!locationDisplay.primary ? 'country-only' : ''}`}>
                      <div className="location-sub">
                        {locationDisplay.secondary}
                        {locationDisplay.countryCode && (
                          <LocationFlag 
                            countryCode={locationDisplay.countryCode} 
                          />
                        )}
                      </div>
                      </div>
                    )
                  )}
              </>
            )}
            
            {/* Weather - show if we have weather data (already checked that locationDisplay !== 'hidden' above) */}
            {weatherDisplay && settings.showWeather && (
              <div className="weather weather-line">
                <div className="weather-text-group">
                  <div className="weather-temperature">
                    {weatherDisplay.temperature}
                  </div>
                  {(weatherDisplay.icon || weatherDisplay.description) && (
                    <div className="weather-condition-group">
                      {weatherDisplay.description && (
                        <span className="weather-description-text">
                          {weatherDisplay.description}
                        </span>
                      )}
                      {weatherDisplay.icon && (
                        <span className="weather-icon-inline">
                          {weatherDisplay.icon}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Altitude & Speed - grouped together */}
            {(altitudeDisplay || speedDisplay) && (
              <div className="movement-data-group">
                {altitudeDisplay && (
                  <div className="weather weather-line movement-data-line">
                    <div className="weather-temperature">
                      {altitudeDisplay.formatted}
                    </div>
                  </div>
                )}
                {speedDisplay && (
                  <div className="weather weather-line movement-data-line">
                    <div className="weather-temperature">
                      {speedDisplay.formatted}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Minimap */}
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
                    isNight={settings.minimapTheme === 'auto' ? isNightTime : settings.minimapTheme === 'dark'}
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

        {/* Bottom Right: To-Do List and/or Poll */}
        {(settings.showTodoList && visibleTodos.length > 0) || settings.pollState ? (
          <div className="bottom-right">
            {settings.showTodoList && visibleTodos.length > 0 && (
              <div className="overlay-box todo-list-box">
                {visibleTodos
                  .sort((a, b) => {
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
            )}
            {settings.pollState && (() => {
              const poll = settings.pollState;
              const now = Date.now();
              const totalVotes = poll.options.reduce((s, o) => s + o.votes, 0);
              const isWinner = poll.status === 'winner';
              const showWinner = isWinner && poll.winnerDisplayUntil != null && now < poll.winnerDisplayUntil;
              if (poll.status === 'active' || (showWinner && totalVotes > 0)) {
                const isNewPoll = poll.id !== lastPollIdRef.current;
                if (isNewPoll) lastPollIdRef.current = poll.id;
                return (
                  <div
                    className={`overlay-box poll-box ${showWinner ? 'poll-box-winner' : ''} ${isNewPoll ? 'poll-fill-instant' : ''}`}
                  >
                    <div className="poll-question">{filterTextForDisplay(poll.question)}</div>
                    <div className="poll-options">
                      {(() => {
                        const maxVotes = Math.max(0, ...poll.options.map((o) => o.votes));
                        const winnerLabels = new Set(
                          poll.options
                            .filter((o) => o.votes === maxVotes && maxVotes > 0)
                            .map((o) => o.label)
                        );
                        const optionsToShow = showWinner
                          ? [...poll.options].sort((a, b) => b.votes - a.votes).filter((o) => winnerLabels.has(o.label))
                          : [...poll.options].sort((a, b) => b.votes - a.votes);
                        return optionsToShow.map((opt) => {
                          const pct = showWinner
                            ? 100
                            : totalVotes > 0
                              ? Math.round((opt.votes / totalVotes) * 100)
                              : 0;
                          const displayLabel = filterOptionForDisplay(opt.label);
                          const isLeading = winnerLabels.has(opt.label);
                          return (
                            <div
                              key={opt.label}
                              className={`poll-option ${showWinner ? 'poll-option-winner' : ''}`}
                            >
                              <div className="poll-option-bar">
                                <div className={`poll-option-fill ${isLeading ? 'poll-option-fill-winner' : ''}`} style={{ width: `${pct}%` }} />
                                <div className="poll-option-text">
                                  <span className="poll-option-label">{displayLabel}</span>
                                  {showWinner && <span className="poll-option-votes">({opt.votes})</span>}
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        ) : null}
      </div>
    </ErrorBoundary>
  );
}

export default OverlayPage;
