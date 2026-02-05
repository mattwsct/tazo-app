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
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { RTIRLPayload } from '@/utils/overlay-constants';
import type { SunriseSunsetData } from '@/utils/api-utils';
import type { LocationData } from '@/utils/location-utils';

// Utility imports
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit, kmhToMph, metersToFeet } from '@/utils/unit-conversions';
import { API_KEYS, TIMERS, SPEED_ANIMATION, ELEVATION_ANIMATION } from '@/utils/overlay-constants';
import { distanceInMeters, formatLocation, formatCountryName } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ } from '@/utils/api-utils';
import { checkRateLimit } from '@/utils/rate-limiting';
import { 
  createLocationWithCountryFallback, 
  createWeatherFallback, 
  createSunriseSunsetFallback,
  isNightTimeFallback
} from '@/utils/fallback-utils';
import { 
  isGpsUpdateFresh, 
  isValidTimezone, 
  clearTimer, 
  safeApiCall,
  formatTimeUTC,
  formatTimeWithTimezone,
  extractAltitude,
  createSettingsHash
} from '@/utils/overlay-helpers';

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
  MINIMAP_HIDE_DELAY,
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
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [minimapOpacity, setMinimapOpacity] = useState(1.0); // Fully opaque for better readability
  const [hasIncompleteLocationData, setHasIncompleteLocationData] = useState(false); // Track if we have incomplete location data (country but no code)
  const [overlayVisible, setOverlayVisible] = useState(false); // Track if overlay should be visible (fade-in delay)
  const settingsLoadedRef = useRef(false); // Track if settings have been loaded from API (prevents logging initial default state change)
  
  // Todo completion tracking with localStorage persistence
  const visibleTodos = useTodoCompletion(settings.todos);

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

  // Update settings hash and re-format location ONLY when locationDisplay changes
  useEffect(() => {
    const newHash = JSON.stringify(settings);
    const hashChanged = newHash !== lastSettingsHash.current;
    const locationDisplayChanged = settings.locationDisplay !== lastLocationDisplayRef.current;
    lastSettingsHash.current = newHash;
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
    const hasCompleteLocationData = lastRawLocation.current && (
      lastRawLocation.current.city || 
      lastRawLocation.current.town || 
      lastRawLocation.current.village || 
      lastRawLocation.current.municipality ||
      lastRawLocation.current.neighbourhood || 
      lastRawLocation.current.suburb || 
      lastRawLocation.current.district
    );
    
    // Re-format location when locationDisplay changes if we have complete location data
    if (hasCompleteLocationData && settings.locationDisplay !== 'hidden') {
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
    } else if (locationDisplayChanged && !hasCompleteLocationData && settingsLoadedRef.current) {
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
  }, [settings.locationDisplay]); // Only depend on locationDisplay, not entire settings object

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
    // RTIRL provides speed in m/s (meters per second), convert to km/h
    if (typeof payload === 'object' && payload !== null && 'speed' in payload) {
      const rawSpeedValue = (payload as RTIRLPayload).speed;
      if (typeof rawSpeedValue === 'number' && rawSpeedValue >= 0) {
        const rtirlSpeedKmh = rawSpeedValue * 3.6;
        
        // If RTIRL explicitly says speed = 0, trust it (you're stationary)
        if (rtirlSpeedKmh === 0) {
          return 0;
        }
        
        // Check if coordinates contradict RTIRL speed (detect stale RTIRL speed)
        // If moved <50m over >10 seconds but RTIRL says moving, RTIRL is likely stale
        if (prevCoords && prevGpsTimestamp > 0) {
          const movedMeters = distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]);
          const timeDiffSeconds = (gpsUpdateTime - prevGpsTimestamp) / 1000;
          
          // If moved very little over reasonable time but RTIRL says moving, it's stale
          // Accounts for different RTIRL accuracy settings (1m, 10m, 100m) and GPS drift
          if (movedMeters < TIMERS.SPEED_STALE_DISTANCE_THRESHOLD && 
              timeDiffSeconds > TIMERS.SPEED_STALE_TIME_THRESHOLD && 
              rtirlSpeedKmh > 5) {
            return 0; // RTIRL speed is stale, coordinates show stationary
          }
        }
        
        // Otherwise, trust RTIRL speed (it's usually more accurate when moving)
        return rtirlSpeedKmh;
      }
    }
    
    // Calculate from coordinates as fallback (when RTIRL speed not available)
    if (!prevCoords || prevGpsTimestamp <= 0) return 0;
    
    const movedMeters = distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]);
    const timeDiffSeconds = (gpsUpdateTime - prevGpsTimestamp) / 1000;
    const timeDiffHours = timeDiffSeconds / 3600;
    
    if (timeDiffHours > 0 && timeDiffSeconds >= TIMERS.MIN_TIME_SECONDS && movedMeters > 0) {
      return (movedMeters / 1000) / timeDiffHours;
    } else if (movedMeters === 0 && timeDiffSeconds > 0) {
      return 0;
    }
    
    return 0;
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
          // Merge with defaults to ensure new fields are initialized
          const mergedSettings = {
            ...DEFAULT_OVERLAY_SETTINGS,
            ...data,
            weatherConditionDisplay: data.weatherConditionDisplay || DEFAULT_OVERLAY_SETTINGS.weatherConditionDisplay,
            altitudeDisplay: data.altitudeDisplay || DEFAULT_OVERLAY_SETTINGS.altitudeDisplay,
            speedDisplay: data.speedDisplay || DEFAULT_OVERLAY_SETTINGS.speedDisplay,
            minimapTheme: data.minimapTheme || DEFAULT_OVERLAY_SETTINGS.minimapTheme,
          };
          setSettings(mergedSettings);
          // Set initial hash to prevent false positives on first poll
          lastSettingsHash.current = createSettingsHash(mergedSettings);
          settingsLoadedRef.current = true; // Mark settings as loaded
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
            // Merge with defaults to ensure new fields are initialized
            const mergedSettings = {
              ...DEFAULT_OVERLAY_SETTINGS,
              ...settingsData,
              weatherConditionDisplay: settingsData.weatherConditionDisplay || DEFAULT_OVERLAY_SETTINGS.weatherConditionDisplay,
              altitudeDisplay: settingsData.altitudeDisplay || DEFAULT_OVERLAY_SETTINGS.altitudeDisplay,
              speedDisplay: settingsData.speedDisplay || DEFAULT_OVERLAY_SETTINGS.speedDisplay,
              minimapTheme: settingsData.minimapTheme || DEFAULT_OVERLAY_SETTINGS.minimapTheme,
            } as OverlaySettings;
            OverlayLogger.settings('Settings updated via SSE', { 
              locationDisplay: mergedSettings.locationDisplay,
              showWeather: mergedSettings.showWeather,
              showMinimap: mergedSettings.showMinimap 
            });
            setSettings(mergedSettings);
            // Update hash to prevent polling from detecting this as a new change
            lastSettingsHash.current = createSettingsHash(mergedSettings);
            settingsLoadedRef.current = true; // Mark settings as loaded
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
              
              // Extract GPS coordinates first (needed for logging and processing)
              const coords = extractCoordinates(payload);
              if (!coords) return;
              
              const [lat, lon] = coords;
              setMapCoords([lat, lon]);
              
              // Get GPS update timestamp from payload
              const payloadTimestamp = extractGpsTimestamp(payload);
              const now = Date.now();
              const timeSincePayload = now - payloadTimestamp;
              const isPayloadFresh = timeSincePayload <= GPS_FRESHNESS_TIMEOUT;
              
              // Log RTIRL payload for debugging (essential info only)
              OverlayLogger.overlay('RTIRL update received', {
                coordinates: { lat, lon },
                speed: payload.speed || 0,
                altitude: payload.altitude !== undefined ? payload.altitude : 'not provided',
                timestamp: payloadTimestamp,
                timestampAge: Math.round(timeSincePayload / 1000),
                timestampAgeMinutes: Math.round(timeSincePayload / 60000),
                isFresh: isPayloadFresh,
                reportedAt: (payload as { reportedAt?: number }).reportedAt,
                updatedAt: (payload as { updatedAt?: number }).updatedAt
              });
              
              // Handle timezone from RTIRL (lowest priority - will be overridden by LocationIQ/OpenWeatherMap)
              // Always update timezone from RTIRL when available, even when GPS is stale
              // This ensures time/date display works even when location/weather are hidden
              if (payload.location?.timezone) {
                // Update timezone even if we already have one - RTIRL provides current location timezone
                // This is important when GPS is stale but we still need accurate time display
                updateTimezoneRef.current(payload.location.timezone);
              }
              
              // Check if GPS data was stale BEFORE this update (for speed calculation)
              // Use GPS timestamp, not reception time, to handle network delays and RTIRL throttling
              const timeSinceLastGps = lastGpsUpdateTime.current > 0 ? (now - lastGpsUpdateTime.current) : Infinity;
              const wasGpsDataStale = timeSinceLastGps > GPS_STALE_TIMEOUT;
              
              // Update GPS timestamps AFTER checking for staleness
              const isFirstGpsUpdate = lastGpsUpdateTime.current === 0;
              lastGpsUpdateTime.current = now; // Track last GPS reception time for staleness detection
              lastGpsTimestamp.current = payloadTimestamp; // Track actual GPS timestamp from payload
              
              // Always use payload timestamp for freshness checks - GPS data age is what matters
              // Even if RTIRL is actively streaming, if the GPS reading itself is >15 minutes old, it's stale
              const isReceivingUpdates = !wasGpsDataStale || isFirstGpsUpdate; // Track if RTIRL is actively sending updates
              
              // Check if GPS update is fresh (for logging purposes only - no longer controls visibility)
              const isFresh = isGpsUpdateFresh(payloadTimestamp, now);
              
              // Get previous coordinates and GPS timestamp for speed calculation
              const prevCoords = lastCoords.current;
              const prevGpsTimestamp = lastGpsTimestamp.current;
              
              // Calculate speed from RTIRL payload and coordinates
              // Use payload timestamp for speed calculation (when GPS reading was taken)
              const speedKmh = calculateSpeed(
                payload,
                lat,
                lon,
                prevCoords,
                prevGpsTimestamp,
                payloadTimestamp, // Use payload timestamp for speed calculation
                wasGpsDataStale
              );
              const roundedSpeed = Math.round(speedKmh);
              
              setCurrentSpeed(roundedSpeed);
              currentSpeedRef.current = roundedSpeed; // Update ref for minimap visibility
              lastSpeedGpsTimestamp.current = payloadTimestamp; // Track GPS timestamp, not reception time
              setSpeedUpdateTimestamp(now); // Trigger re-render
              
              // Extract altitude from RTIRL payload
              const altitudeValue = extractAltitude(payload);
              
              if (altitudeValue !== null) {
                const roundedAltitude = Math.round(altitudeValue);
                setCurrentAltitude(roundedAltitude);
                lastAltitudeGpsTimestamp.current = payloadTimestamp; // Track GPS timestamp, not reception time
                setAltitudeUpdateTimestamp(now); // Trigger re-render
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
                const movedMeters = prevCoords ? distanceInMeters(lat, lon, prevCoords[0], prevCoords[1]) : Infinity;

              // Detect dramatic coordinate changes (e.g., jumping continents, long-distance travel)
              // Force immediate fetch to update timezone/location/weather quickly
              const isDramaticChange = movedMeters > TIMERS.DRAMATIC_CHANGE_THRESHOLD;

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
              // Also fetch if we don't have weather data yet or weather is getting stale
              // OR if dramatic change detected (force immediate update for timezone)
              const hasWeatherData = lastSuccessfulWeatherFetch.current > 0;
              const weatherDataAge = hasWeatherData 
                ? now - lastSuccessfulWeatherFetch.current 
                : Infinity;
              const shouldFetchWeather = isDramaticChange || // Force fetch on dramatic changes
                lastWeatherTime.current === 0 || 
                weatherElapsed >= TIMERS.WEATHER_UPDATE_INTERVAL ||
                !hasWeatherData || // Fetch if no weather data
                weatherDataAge >= WEATHER_DATA_VALIDITY_TIMEOUT; // Fetch if weather is stale
              
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
              // EXCEPTION: Dramatic changes (>50km) bypass gates to update timezone/location immediately
              const LOCATION_MIN_INTERVAL = 18000; // 18 seconds minimum (safely under 5,000/day limit)
              const shouldFetchLocation = isDramaticChange || // Force fetch on dramatic changes
                lastLocationTime.current === 0 || 
                (locationElapsed >= LOCATION_MIN_INTERVAL && meetsDistance);
              
              // If settings just updated (hash changed), allow UI update but do not force API refetch here
              // API fetching remains purely based on the time/distance gates above

              // Fetch weather and location in parallel for faster loading
              // Only fetch if GPS is fresh - don't fetch location/weather when GPS is stale
              // Timezone will still be updated from RTIRL even when GPS is stale
              const promises: Promise<void>[] = [];
              
              // Fetch weather when needed (no GPS staleness check - always fetch when conditions are met)
              // Weather updates periodically (every 5 min) or when data is stale
              // Check rate limits: 50 per minute (well under 60/min free tier limit)
              const needsTimezone = !isValidTimezone(timezoneRef.current);
              const shouldFetchWeatherNow = shouldFetchWeather && API_KEYS.OPENWEATHER && 
                !weatherFetchInProgress.current && // Prevent concurrent weather fetches
                checkRateLimit('openweathermap') && // Check rate limits before fetching
                (shouldFetchWeather || needsTimezone); // Fetch if conditions met OR if we need timezone
              
              // Log weather fetch decision for debugging (only when actually fetching)
              if (shouldFetchWeather && API_KEYS.OPENWEATHER && shouldFetchWeatherNow) {
                OverlayLogger.weather('Weather fetch check', {
                  willFetch: true,
                  reason: !checkRateLimit('openweathermap') ? 'rate limited' :
                          weatherFetchInProgress.current ? 'fetch in progress' :
                          needsTimezone ? 'timezone needed' :
                          shouldFetchWeather ? 'conditions met' : 'not needed',
                  needsTimezone,
                  weatherElapsed: Math.round(weatherElapsed / 1000),
                  weatherDataAge: hasWeatherData ? Math.round(weatherDataAge / 60000) : 'none'
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
              
              // Only fetch location if GPS is fresh - don't fetch when stale
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
                        OverlayLogger.location('LocationIQ rate limited, skipping fetch - will retry on next GPS update');
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
                        if (formatted.primary.trim() || formatted.secondary) {
                        // Log location updates (only when actually updating)
                        OverlayLogger.location('Location updated from fresh RTIRL data', {
                          mode: currentDisplayMode,
                          primary: formatted.primary.trim() || 'none',
                          secondary: formatted.secondary || 'none'
                        });
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
                        OverlayLogger.location('Updating timezone from LocationIQ', { 
                          timezone: loc.timezone,
                          previousTimezone: timezoneRef.current 
                        });
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

  // Fade-in delay: Start overlay hidden, then fade in after 2 seconds to allow everything to load
  useEffect(() => {
    const fadeInTimer = setTimeout(() => {
      setOverlayVisible(true);
    }, 2000); // 2 second delay before fade-in to allow flags, images, and data to load

    return () => {
      clearTimeout(fadeInTimer);
    };
  }, []); // Run once on mount

  // Memoized display values
  // IMPORTANT: This memo re-formats location from raw data when settings change
  // This ensures location display updates immediately when settings change, even if location state hasn't updated yet
  const locationDisplay = useMemo(() => {
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      return {
        primary: settings.customLocation?.trim() || '',
        secondary: location?.secondary, // Secondary line (city/state/country) - in custom mode this shows the actual country name
        countryCode: location?.countryCode?.toUpperCase()
      };
    }
    
    // If we have raw location data, re-format it with current settings to ensure display mode changes are reflected immediately
    // This handles the case where settings change but location state hasn't updated yet
    const hasCompleteLocationData = lastRawLocation.current && (
      lastRawLocation.current.city || 
      lastRawLocation.current.town || 
      lastRawLocation.current.village || 
      lastRawLocation.current.municipality ||
      lastRawLocation.current.neighbourhood || 
      lastRawLocation.current.suburb || 
      lastRawLocation.current.district
    );
    
    if (hasCompleteLocationData) {
      try {
        const formatted = formatLocation(lastRawLocation.current, settings.locationDisplay);
        // Return formatted location with current settings
        return {
          primary: formatted.primary || '',
          secondary: formatted.secondary,
          countryCode: formatted.countryCode?.toUpperCase()
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
        countryCode: location.countryCode?.toUpperCase()
      };
    }
    
    // No location data yet - return null so UI stays blank
    return null;
  }, [location, settings.locationDisplay, settings.customLocation]);


  // Force periodic recalculation of day/night by updating a timestamp every minute
  const [dayNightCheckTime, setDayNightCheckTime] = useState(Date.now());
  
  useEffect(() => {
    // Update every minute to recalculate day/night
    const interval = setInterval(() => {
      setDayNightCheckTime(Date.now());
    }, 60000); // Check every minute
    
    return () => clearInterval(interval);
  }, []);

  // Accurate day/night check using OpenWeatherMap sunrise/sunset data
  // Recalculates when sunriseSunset, timezone, or dayNightCheckTime changes
  const isNightTime = useMemo((): boolean => {
    if (!sunriseSunset) {
      // Fallback to simple time-based check if no API data
      // Only log warning at runtime, not during build (expected during static generation)
      if (typeof window !== 'undefined') {
        OverlayLogger.warn('No sunrise/sunset data available, using fallback detection');
      }
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
  }, [sunriseSunset, timezone, dayNightCheckTime]);

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
      const now = Date.now();
      
      // Check GPS staleness - hide if GPS data is older than 1 minute
      const timeSinceAltitudeUpdate = lastAltitudeGpsTimestamp.current > 0 ? (now - lastAltitudeGpsTimestamp.current) : Infinity;
      const ALTITUDE_STALE_TIMEOUT = TIMERS.ONE_MINUTE;
      const isAltitudeStale = timeSinceAltitudeUpdate > ALTITUDE_STALE_TIMEOUT;
      
      // Hide if stale
      if (isAltitudeStale) {
        return null;
      }
      
      // Show only if elevation is above threshold (notable elevation like mountains/hills)
      // 500m threshold filters out almost all major cities, only shows notable mountains/hills
      const ELEVATION_THRESHOLD = 500; // meters
      if (currentAltitude < ELEVATION_THRESHOLD) {
        return null;
      }
    }
    
    // Show altitude (auto mode with notable change detected)
    const altitudeM = displayedAltitude;
    const altitudeFt = metersToFeet(altitudeM);
    return { value: altitudeM, formatted: `${altitudeM.toLocaleString()} m (${altitudeFt.toLocaleString()} ft)` };
  }, [currentAltitude, displayedAltitude, settings.altitudeDisplay, altitudeUpdateTimestamp]);

  // Speed display logic
  const speedDisplay = useMemo(() => {
    // Check display mode first
    if (settings.speedDisplay === 'hidden') {
      return null;
    }
    
    // Check staleness only for "auto" mode - "always" mode shows even if stale
    if (settings.speedDisplay === 'auto') {
      const now = Date.now();
      // Use GPS timestamp for staleness check (not reception time) - works correctly when stationary
      const timeSinceSpeedUpdate = lastSpeedGpsTimestamp.current > 0 ? (now - lastSpeedGpsTimestamp.current) : Infinity;
      const isSpeedStale = timeSinceSpeedUpdate > GPS_STALE_TIMEOUT; // 10 seconds
      
      // Hide if stale (regardless of speed value)
      if (isSpeedStale) {
        return null;
      }
      
      // Auto mode: show if >= 10 km/h (above walking pace)
      if (currentSpeed < 10) {
        return null;
      }
    }
    
    // Show speed (either always mode, or auto mode with speed >= 10 km/h)
    // In always mode, show even if speed is 0
    const speedKmh = displayedSpeed;
    const speedMph = kmhToMph(speedKmh);
    return { value: speedKmh, formatted: `${Math.round(speedKmh)} km/h (${Math.round(speedMph)} mph)` };
  }, [currentSpeed, displayedSpeed, settings.speedDisplay, speedUpdateTimestamp]);

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

export default OverlayPage;
