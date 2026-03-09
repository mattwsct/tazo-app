"use client";

// React imports
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Next.js imports
import dynamic from 'next/dynamic';

// Component imports
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Hook imports
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useRenderPerformance } from '@/lib/performance';
import { useTimeDisplay } from '@/hooks/overlay/useTimeDisplay';
import { useWeatherData } from '@/hooks/overlay/useWeatherData';
import { useLocationData } from '@/hooks/overlay/useLocationData';
import { useMovementData } from '@/hooks/overlay/useMovementData';
import { useMinimapVisibility } from '@/hooks/overlay/useMinimapVisibility';

// Type imports
import type { RTIRLPayload } from '@/utils/overlay-constants';
import type { SunriseSunsetData } from '@/utils/api-utils';
import type { LocationData } from '@/utils/location-utils';

// Utility imports
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit, kmhToMph, metersToFeet } from '@/utils/unit-conversions';
import { API_KEYS, TIMERS, SPEED_ANIMATION, ELEVATION_ANIMATION } from '@/utils/overlay-constants';
import { formatLocation, formatCountryName } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ } from '@/utils/api-utils';
import { checkRateLimit, canMakeApiCall } from '@/utils/rate-limiting';
import {
  createLocationWithCountryFallback,
  createWeatherFallback,
  createSunriseSunsetFallback,
} from '@/utils/fallback-utils';
import {
  clearTimer,
  safeApiCall,
  isValidTimezone,
} from '@/utils/overlay-helpers';
import {
  hasCompleteLocationData,
  formatCountryCode,
  shouldShowDisplayMode,
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
import { isSpeedStale } from '@/utils/staleness-utils';
import { isNotableWeatherCondition } from '@/utils/weather-chat';
import { useOverlaySettings } from '@/hooks/useOverlaySettings';
import { filterOptionForDisplay, filterTextForDisplay } from '@/lib/poll-content-filter';
import BottomRightPanel from '@/components/BottomRightPanel';
import WeatherRotatingSlot from '@/components/WeatherRotatingSlot';

// Extract constants for cleaner code
const {
  WALKING_PACE_THRESHOLD,
  MINIMAP_SPEED_MIN_READINGS,
  GPS_STALE_TIMEOUT,
  ALTITUDE_CHANGE_THRESHOLD_M,
  ALTITUDE_DISPLAY_DURATION_MS,
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

const TopLeftRotatingWellness = dynamic(() => import('@/components/TopLeftRotatingWellness'), {
  ssr: false,
  loading: () => null
});

const TopRightRotatingSlot = dynamic(() => import('@/components/TopRightRotatingSlot'), {
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

  // Settings
  const [settings, setSettings, settingsLoadedRef, refreshSettings] = useOverlaySettings();

  // Weather data hook
  const {
    weather,
    sunriseSunset,
    timezone,
    setSunriseSunset,
    weatherFetchInProgress,
    lastWeatherTime,
    lastSuccessfulWeatherFetch,
    updateWeather,
    updateTimezone,
    computeIsNightTime,
  } = useWeatherData();

  // Location data hook (depends on updateTimezone)
  const {
    location,
    setLocation,
    lastRawLocation,
    locationReceivedFromRtirlRef,
    lastLocationSourceTimestampRef,
    persistentFallbackTimerRef,
    lastLocationTime,
    lastSuccessfulLocationFetch,
    locationFetchInProgress,
    updateLocation,
  } = useLocationData(updateTimezone);

  // Movement data hook
  const {
    currentSpeed,
    setCurrentSpeed,
    currentAltitude,
    setCurrentAltitude,
    mapCoords,
    setMapCoords,
    speedUpdateTimestamp,
    setSpeedUpdateTimestamp,
    altitudeUpdateTimestamp,
    setAltitudeUpdateTimestamp,
    gpsTimestampForDisplay,
    setGpsTimestampForDisplay,
    altitudeShowUntil,
    setAltitudeShowUntil,
    altitudeBaselineRef,
    currentAltitudeRef,
    altitudeShowTimeoutRef,
    currentSpeedRef,
    lastGpsUpdateTime,
    lastGpsTimestamp,
    lastCoords,
    lastCoordsTime,
    lastSpeedGpsTimestamp,
    lastAltitudeGpsTimestamp,
    lastStatsUpdateTime,
    lastSentSpeed,
    lastSentAltitude,
  } = useMovementData();

  // Speed readings ref for minimap visibility (defined here so RTIRL listener can also write to it)
  const speedReadingsRef = useRef<{ speed: number; ts: number }[]>([]);

  // Minimap visibility hook
  const {
    minimapVisible,
    minimapOpacity,
    sustainedSpeedVisibleRef,
    updateMinimapVisibility,
  } = useMinimapVisibility({
    lastGpsUpdateTime,
    speedReadingsRef,
    currentSpeed,
    settings,
  });

  // Overlay fade-in state
  const [overlayVisible, setOverlayVisible] = useState(false);
  
  // When active poll countdown ends: show winner immediately from current votes, then sync with server
  const pollCountdownRef = useRef<{ pollId: string } | null>(null);
  const latestPollRef = useRef<typeof settings.pollState>(null);
  const lastPollIdRef = useRef<string | null>(null);
  const pollShimmerPhaseRef = useRef<{ pollId: string; phase: number } | null>(null);
  if (settings.pollState?.status === 'active') latestPollRef.current = settings.pollState;

  useEffect(() => {
    const poll = settings.pollState;
    if (poll?.status !== 'active') {
      pollCountdownRef.current = null;
      return;
    }
    const endsAt = poll.startedAt + poll.durationSeconds * 1000;
    const remainingMs = Math.max(0, endsAt - Date.now());
    const winnerDisplaySeconds = 10;
    pollCountdownRef.current = { pollId: poll.id };

    const runPollEnd = () => {
      pollCountdownRef.current = null;
      const current = latestPollRef.current;
      const totalVotes = current?.options?.reduce((s, o) => s + o.votes, 0) ?? 0;

      // Update UI immediately (optimistic): show winner or clear, then sync with server when it responds
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
          // After winner display, clear the slot and fetch server state (next poll or null)
          setTimeout(() => {
            lastPollIdRef.current = null;
            setSettings((prev) => ({ ...prev, pollState: null }));
            refreshSettings();
          }, winnerDisplaySeconds * 1000);
        } else {
          lastPollIdRef.current = null;
          setSettings((prev) => ({ ...prev, pollState: null }));
          refreshSettings();
        }
      }

      // Fire-and-forget: tell server to end poll and post winner to chat; SSE/refresh will overwrite with authoritative state
      fetch('/api/poll-end-trigger', { cache: 'no-store' }).catch(() => {});
    };

    // Always schedule a timeout (no early return). When vote updates change settings.pollState, this effect
    // re-runs and replaces the timeout; the timer must fire when the poll ends even if no chat messages arrive.
    // If the poll is already past end (e.g. tab was backgrounded), run immediately.
    const timeout = remainingMs <= 0 ? null : setTimeout(runPollEnd, remainingMs);
    if (remainingMs <= 0) runPollEnd();
    return () => (timeout != null ? clearTimeout(timeout) : undefined);
  }, [settings.pollState, refreshSettings, setSettings]);

  // Re-render every second when showing winner or active poll (for timer bar)
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    const poll = settings.pollState;
    const isWinnerDisplay = poll?.status === 'winner' && poll.winnerDisplayUntil != null && Date.now() < poll.winnerDisplayUntil;
    const isActivePoll = poll?.status === 'active';
    if (isWinnerDisplay || isActivePoll) {
      const id = setInterval(() => setPollTick((n) => n + 1), 1000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [settings.pollState, pollTick]);

  // Stats update throttling constants (kept local; not worth a hook)
  const STATS_UPDATE_INTERVAL = 5000; // Send stats updates every 5 seconds max
  const SPEED_CHANGE_THRESHOLD = 2; // Only send if speed changed by 2+ km/h
  const ALTITUDE_CHANGE_THRESHOLD = 10; // Only send if altitude changed by 10+ meters

  // Track the last locationDisplay value to detect actual changes
  const lastLocationDisplayRef = useRef<string | undefined>(undefined);

  // Re-format location when locationDisplay changes
  useEffect(() => {
    const locationDisplayChanged = settings.locationDisplay !== lastLocationDisplayRef.current;
    lastLocationDisplayRef.current = settings.locationDisplay;

    if (!locationDisplayChanged) {
      return;
    }

    const hasCompleteData = hasCompleteLocationData(lastRawLocation.current);
    if (hasCompleteData && settings.locationDisplay !== 'hidden') {
      try {
        const formatted = formatLocation(lastRawLocation.current!, settings.locationDisplay);
        setLocation({
          primary: formatted.primary || '',
          secondary: formatted.secondary,
          countryCode: lastRawLocation.current!.countryCode || ''
        });
      } catch (error) {
        OverlayLogger.warn('Location re-formatting failed on settings change', { error });
      }
    } else if (locationDisplayChanged && !hasCompleteData && settingsLoadedRef.current) {
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


  // Time display hook (depends on timezone from useWeatherData)
  const { timeDisplay } = useTimeDisplay(timezone);

  // Extract GPS timestamp from RTIRL payload (still needed for location update in RTIRL closure)
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

  // Cleanup altitude show timeout on unmount
  useEffect(() => {
    return () => {
      clearTimer(altitudeShowTimeoutRef);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- altitudeShowTimeoutRef is a stable ref

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
                currentAltitudeRef.current = roundedAltitude;
                lastAltitudeGpsTimestamp.current = payloadTimestamp;
                setAltitudeUpdateTimestamp(now);
                // Auto mode: track baseline and show when notable change from baseline
                if (altitudeBaselineRef.current === null) {
                  altitudeBaselineRef.current = roundedAltitude;
                } else {
                  const change = Math.abs(roundedAltitude - altitudeBaselineRef.current);
                  if (change >= ALTITUDE_CHANGE_THRESHOLD_M) {
                    const showUntil = now + ALTITUDE_DISPLAY_DURATION_MS;
                    setAltitudeShowUntil(showUntil);
                    altitudeBaselineRef.current = roundedAltitude; // Reset baseline so next trigger is from here
                    clearTimer(altitudeShowTimeoutRef);
                    altitudeShowTimeoutRef.current = setTimeout(() => {
                      altitudeShowTimeoutRef.current = null;
                      setAltitudeShowUntil(0);
                      altitudeBaselineRef.current = currentAltitudeRef.current ?? roundedAltitude; // New baseline = current when we hide
                      setAltitudeUpdateTimestamp(Date.now());
                    }, ALTITUDE_DISPLAY_DURATION_MS);
                  }
                }
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
              
              // Track speed readings with timestamps for minimap visibility
              if (settingsRef.current.minimapSpeedBased) {
                if (roundedSpeed >= WALKING_PACE_THRESHOLD) {
                  // Keep only the last N readings above threshold; drop all readings if speed drops
                  speedReadingsRef.current.push({ speed: roundedSpeed, ts: now });
                  if (speedReadingsRef.current.length > MINIMAP_SPEED_MIN_READINGS) {
                    speedReadingsRef.current.shift();
                  }
                } else {
                  // Speed dropped — clear readings so we require a fresh sustained run
                  sustainedSpeedVisibleRef.current = false;
                  speedReadingsRef.current = [];
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
                // Minutely precipitation forecast removed — overlay shows current condition + temperature only
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
                      
                      // Update persistent RTIRL coordinates (GPS only — no location text sent to server).
                      // City/country names are set exclusively by the server-side cron via reverse geocoding.
                      const payloadTimestamp = extractGpsTimestamp(payload);
                      const rtirlUpdatedAt = payloadTimestamp || Date.now();
                      lastLocationSourceTimestampRef.current = rtirlUpdatedAt;
                      const coordsPayload = {
                        rtirl: { lat: lat!, lon: lon!, raw: payload, updatedAt: rtirlUpdatedAt },
                        updatedAt: rtirlUpdatedAt,
                      };
                      const doUpdate = (retryCount = 0) => {
                        fetch('/api/location', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(coordsPayload),
                        })
                          .then(res => {
                            if (res.ok && process.env.NODE_ENV !== 'production') {
                              OverlayLogger.location('GPS coordinates saved', { lat: lat!, lon: lon! });
                            } else if (!res.ok && retryCount < 1) {
                              OverlayLogger.warn('GPS coordinates save failed, retrying', { status: res.status });
                              setTimeout(() => doUpdate(retryCount + 1), 2000);
                            } else if (!res.ok) {
                              OverlayLogger.warn('GPS coordinates save failed', { status: res.status });
                            }
                          })
                          .catch(err => {
                            if (retryCount < 1) {
                              OverlayLogger.warn('GPS coordinates save error, retrying', { error: err });
                              setTimeout(() => doUpdate(retryCount + 1), 2000);
                            }
                          });
                      };
                      doUpdate();
                      
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
                        // Don't update lastSuccessfulLocationFetch - we're hiding, not caching
                      } else if (rawCountryName) {
                        // We have both country name and code - safe to display
                        // We have both country name and code - safe to display
                        OverlayLogger.warn('LocationIQ returned only country data, using country name');
                        // Format country name (e.g., "United States of America" -> "USA")
                        const formattedCountryName = formatCountryName(rawCountryName, countryCode);
                        updateLocation({
                          primary: formattedCountryName,
                          secondary: undefined,
                          countryCode: countryCode
                        });
                        // Persist GPS coordinates only — no location text sent to server.
                        {
                          const payloadTimestamp = extractGpsTimestamp(payload);
                          const coordsOnly = {
                            rtirl: { lat: lat!, lon: lon!, raw: payload, updatedAt: payloadTimestamp || Date.now() },
                            updatedAt: Date.now(),
                          };
                          const doCountryUpdate = (retryCount = 0) => {
                            fetch('/api/location', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(coordsOnly),
                            })
                              .then(res => {
                                if (!res.ok && retryCount < 1) setTimeout(() => doCountryUpdate(retryCount + 1), 2000);
                              })
                              .catch(() => { if (retryCount < 1) setTimeout(() => doCountryUpdate(retryCount + 1), 2000); });
                          };
                          doCountryUpdate();
                        }
                      }
                      
                      // Use timezone if available
                      if (loc!.timezone) {
                        updateTimezone(loc!.timezone);
                      }
                    } else {
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
    if (hasCompleteLocationData(lastRawLocation.current)) {
      try {
        const formatted = formatLocation(lastRawLocation.current, settings.locationDisplay);
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
  const isNightTime = useMemo(() => computeIsNightTime(staleCheckTime), [computeIsNightTime, staleCheckTime]);

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

  const weatherDisplay = useMemo(() => {
    if (!weather) return null;

    const notable = isNotableWeatherCondition(weather.desc);
    const icon = notable ? getWeatherIcon(weather.desc, true, isNightTime) : null;

    return {
      temperature: `${weather.temp}°C (${celsiusToFahrenheit(weather.temp)}°F)`,
      icon,
      // Only show condition text when it's notable (rain, fog, storm, etc.)
      // Clear skies and plain clouds are omitted — temperature already conveys the vibe
      description: notable ? weather.desc : null,
    };
  }, [weather, getWeatherIcon, isNightTime]);

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

  // Altitude display logic - auto shows when altitude changes notably from baseline, hides when no longer relevant
  const altitudeDisplay = useMemo(() => {
    if (currentAltitude === null || displayedAltitude === null) return null;
    const now = Date.now();
    const isInShowWindow = altitudeShowUntil > 0 && now < altitudeShowUntil;
    if (!isInShowWindow) return null;
    const altitudeM = displayedAltitude;
    const altitudeFt = metersToFeet(altitudeM);
    return { value: altitudeM, formatted: `${altitudeM.toLocaleString()} m (${altitudeFt.toLocaleString()} ft)` };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- altitudeUpdateTimestamp + altitudeShowUntil
  }, [currentAltitude, displayedAltitude, altitudeUpdateTimestamp, altitudeShowUntil]);

  // Speed display logic - auto shows when speed >= 10 km/h and fresh, hides when stale or below threshold
  // When speed-based minimap is on, speed display is locked to minimap (same sustained-speed condition)
  const speedDisplay = useMemo(() => {
    const speedIsStale = isSpeedStale(lastSpeedGpsTimestamp.current);
    const meetsSpeedThreshold = currentSpeed >= 10;
    if (!shouldShowDisplayMode('auto', speedIsStale, meetsSpeedThreshold)) return null;
    if (settings.minimapSpeedBased && !sustainedSpeedVisibleRef.current) return null;
    const speedKmh = displayedSpeed;
    const speedMph = kmhToMph(speedKmh);
    return { value: speedKmh, formatted: `${Math.round(speedKmh)} km/h (${Math.round(speedMph)} mph)` };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- speedUpdateTimestamp + speedStaleCheckTime force re-run (latter when no RTIRL); minimapVisible so speed display follows minimap in speed-based mode
  }, [currentSpeed, displayedSpeed, speedUpdateTimestamp, speedStaleCheckTime, settings.minimapSpeedBased, minimapVisible]);

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

            <ErrorBoundary fallback={null}>
              <TopLeftRotatingWellness
                date={timeDisplay.date ?? null}
                timezoneValid={isValidTimezone(timezone)}
                settings={settings}
              />
            </ErrorBoundary>
            <ErrorBoundary fallback={<div className="heart-rate-line">Heart rate unavailable</div>}>
              <HeartRateMonitor pulsoidToken={API_KEYS.PULSOID} />
            </ErrorBoundary>
          </div>
        </div>

        <div className="top-right">
          {settings.locationDisplay !== 'hidden' && (
            <>
          <div className="overlay-box">
            {/* Location: two-line display — line 1: city/state/custom, line 2: country + flag */}
            {locationDisplay && (locationDisplay.primary || locationDisplay.secondary || locationDisplay.countryCode) && (
              <div className="location location-line">
                {/* Line 1: city / state name, or custom text */}
                {(settings.locationDisplay === 'custom' ? settings.customLocation?.trim() : locationDisplay.primary) && (
                  <span className="location-main">
                    {settings.locationDisplay === 'custom' ? settings.customLocation!.trim() : locationDisplay.primary}
                  </span>
                )}
                {/* Line 2: country name + flag */}
                {(locationDisplay.secondary || locationDisplay.countryCode) && (
                  <div className="location-secondary-line">
                    {locationDisplay.secondary && (
                      <span className="location-country-text">{locationDisplay.secondary}</span>
                    )}
                    {locationDisplay.countryCode && (
                      <LocationFlag countryCode={locationDisplay.countryCode} />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Weather: rotates between temperature and condition (current only, no forecast).
                Synced to the 10s wall-clock tick shared with goals and other overlay rotations. */}
            {settings.showWeather !== false && weatherDisplay && (
              <WeatherRotatingSlot
                temperature={weatherDisplay.temperature}
                condition={
                  weatherDisplay.description
                    ? { label: weatherDisplay.description, icon: weatherDisplay.icon ?? '' }
                    : null
                }
              />
            )}

            {/* Altitude/speed: static if only one, rotating if both present */}
            <ErrorBoundary fallback={null}>
              <TopRightRotatingSlot
                altitudeDisplay={altitudeDisplay}
                speedDisplay={speedDisplay}
                showAltitude={settings.showAltitude}
                showSpeed={settings.showSpeed}
              />
            </ErrorBoundary>
          </div>
          
          {/* Minimap — parent block only renders when locationDisplay !== 'hidden' */}
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
                    locationDisplay={settings.locationDisplay}
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

        {/* Bottom Right: Poll, Trivia, Alerts */}
        {settings.pollState ||
        settings.triviaState ||
        settings.showOverlayAlerts !== false ? (
          <BottomRightPanel settings={settings} refreshSettings={refreshSettings}>
            {(() => {
              const poll = settings.pollState;
              const trivia = settings.triviaState;
              const now = Date.now();
              const isPollActive = poll && (poll.status === 'active' || (poll.status === 'winner' && poll.winnerDisplayUntil != null && now < poll.winnerDisplayUntil));
              const totalVotes = poll?.options?.reduce((s, o) => s + o.votes, 0) ?? 0;
              const showPoll = !!(isPollActive && totalVotes >= 0);
              if (showPoll && poll) {
                const isWinner = poll.status === 'winner';
                const showWinner = isWinner && poll.winnerDisplayUntil != null && now < poll.winnerDisplayUntil;
                const isNewPoll = poll.id !== lastPollIdRef.current;
                if (isNewPoll) lastPollIdRef.current = poll.id;
                return (
                  <div
                    className={`overlay-box poll-box ${showWinner ? 'poll-box-winner' : ''} ${isNewPoll ? 'poll-fill-instant' : ''}`}
                  >
                    <div className="poll-badge">POLL</div>
                    <div className="poll-question">{filterTextForDisplay(poll.question)}</div>
                    {!showWinner && poll.status === 'active' && (
                      <div className="poll-timer-bar" aria-label="Time remaining">
                        <div
                          className="poll-timer-bar-fill"
                          style={{
                            width: `${Math.max(0, Math.min(100, ((poll.startedAt + poll.durationSeconds * 1000 - now) / (poll.durationSeconds * 1000)) * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                    {showWinner && poll.topVoter && poll.topVoter.count > 1 && (
                      <div className="poll-top-voter">
                        Top voter: {filterTextForDisplay(poll.topVoter.username)} ({poll.topVoter.count} votes)
                      </div>
                    )}
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
                        // Stable phase per poll so shimmer stays in sync across all winner bars (avoid recalc on every render)
                        if (winnerLabels.size > 0) {
                          if (!pollShimmerPhaseRef.current || pollShimmerPhaseRef.current.pollId !== poll.id) {
                            pollShimmerPhaseRef.current = { pollId: poll.id, phase: Date.now() % 5000 };
                          }
                        } else {
                          pollShimmerPhaseRef.current = null;
                        }
                        const animPhase = pollShimmerPhaseRef.current?.phase ?? 0;
                        return optionsToShow.map((opt) => {
                          const pct = showWinner
                            ? 100
                            : totalVotes > 0
                              ? Math.round((opt.votes / totalVotes) * 100)
                              : 0;
                          const displayLabel = filterOptionForDisplay(opt.label);
                          const isLeading = winnerLabels.has(opt.label);
                          const voteStr = opt.votes === 1 ? '1 vote' : `${opt.votes} votes`;
                          return (
                            <div
                              key={opt.label}
                              className={`poll-option ${showWinner ? 'poll-option-winner' : ''}`}
                            >
                              <div className="poll-option-bar">
                                <div
                                  className={`poll-option-fill ${isLeading ? 'poll-option-fill-winner' : ''}`}
                                  style={{
                                    width: `${pct}%`,
                                    ...(isLeading && { animationDelay: `-${animPhase}ms` }),
                                  }}
                                />
                                <div className="poll-option-text">
                                  <span className="poll-option-label">
                                    {showWinner ? `Winner - ${displayLabel} (${voteStr})` : (opt.votes > 1 ? `${displayLabel} (${opt.votes} votes)` : displayLabel)}
                                  </span>
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
              if (trivia) {
                const isTriviaWinnerPhase =
                  trivia.winnerDisplayUntil != null && now < trivia.winnerDisplayUntil;
                const showTriviaBox =
                  !trivia.winnerDisplayUntil || now < trivia.winnerDisplayUntil;
                if (!showTriviaBox) return null;
                if (isTriviaWinnerPhase && trivia.winnerUsername != null) {
                  return (
                    <div className="overlay-box trivia-box trivia-box-winner">
                      <div className="trivia-badge">TRIVIA</div>
                      <div className="trivia-winner-line">
                        {filterTextForDisplay(trivia.winnerUsername)} got it!
                      </div>
                      <div className="trivia-answer-reward">
                        {filterTextForDisplay(trivia.winnerAnswer ?? '')} — {trivia.winnerPoints ?? 0} Credits
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="overlay-box trivia-box">
                    <div className="trivia-badge">TRIVIA</div>
                    <div className="trivia-question">{filterTextForDisplay(trivia.question)}</div>
                    <div className="trivia-reward">
                      First correct answer wins {trivia.points} Credits
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </BottomRightPanel>
        ) : null}
      </div>
    </ErrorBoundary>
  );
}

export default OverlayPage;
