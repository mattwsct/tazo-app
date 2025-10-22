"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit } from '@/utils/unit-conversions';
import { API_KEYS, THRESHOLDS, TIMERS, DYNAMIC_TIMERS, API_RATE_LIMITS, type RTIRLPayload } from '@/utils/overlay-constants';
import { distanceInMeters } from '@/utils/location-utils';
import { fetchWeatherAndTimezoneFromOpenWeatherMap, fetchLocationFromLocationIQ, type SunriseSunsetData } from '@/utils/api-utils';
import { formatLocation, type LocationData } from '@/utils/location-utils';
import { 
  createLocationWithCountryFallback, 
  createWeatherFallback, 
  createSunriseSunsetFallback,
  isNightTimeFallback
} from '@/utils/fallback-utils';
import { getOverallHealth } from '@/utils/api-health';

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

export default function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // State
  const [timeDisplay, setTimeDisplay] = useState({ time: '', date: '' });
  const [location, setLocation] = useState<{ 
    primary: string; 
    context?: string;
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
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [dayNightTrigger, setDayNightTrigger] = useState(0); // Triggers recalculation of day/night
  const [apiHealth, setApiHealth] = useState<{ isHealthy: boolean; unhealthyApis: string[] }>({ isHealthy: true, unhealthyApis: [] });

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const settingsRef = useRef(settings);
  const lastSettingsHash = useRef<string>('');
  const lastRawLocation = useRef<LocationData | null>(null);
  
  // API rate limiting tracking (per-second only)
  const lastLocationIqCall = useRef(0);
  
  // GPS update tracking for minimap
  const gpsUpdateTimes = useRef<number[]>([]);
  const lastMinimapHideTime = useRef(0);
  const minimapCooldownRef = useRef<NodeJS.Timeout | null>(null);
  
  
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

  // Location update thresholds - weather has separate logic
  const getLocationUpdateThresholds = useCallback(() => {
    return {
      distanceThreshold: THRESHOLDS.LOCATION_MOVEMENT_THRESHOLD, // 100 meters
      timeThreshold: DYNAMIC_TIMERS.UPDATE_INTERVAL, // 1 minute
    };
  }, []);

  // GPS update rate checking for minimap
  const checkGpsUpdateRate = useCallback(() => {
    const now = Date.now();
    const recentUpdates = gpsUpdateTimes.current.filter(time => now - time < 30000); // Last 30 seconds
    gpsUpdateTimes.current = recentUpdates; // Keep only recent updates
    
    // Require at least 2 updates in the last 30 seconds to consider GPS active
    return recentUpdates.length >= 2;
  }, []);

  // Minimap visibility logic with cooldown
  const updateMinimapVisibility = useCallback(() => {
    const now = Date.now();
    const isGpsActive = checkGpsUpdateRate();
    const isMovingFast = currentSpeed >= 10; // 10 km/h threshold
    const gpsTimeoutPeriod = 30000; // 30 seconds without GPS updates
    
    // Clear existing cooldown timer
    if (minimapCooldownRef.current) {
      clearTimeout(minimapCooldownRef.current);
      minimapCooldownRef.current = null;
    }
    
    if (settings.minimapSpeedBased) {
      // Auto on movement mode
      if (isMovingFast && isGpsActive) {
        // Show immediately when moving fast (10+ km/h) and GPS is active
        setMinimapVisible(true);
        lastMinimapHideTime.current = 0; // Reset hide time
      } else if (!isGpsActive) {
        // No GPS updates in 30 seconds - hide immediately
        setMinimapVisible(false);
        lastMinimapHideTime.current = 0;
      } else if (!isMovingFast && minimapVisible) {
        // Speed dropped below 10 km/h - start cooldown
        if (lastMinimapHideTime.current === 0) {
          lastMinimapHideTime.current = now;
        }
        // Hide after cooldown period
        minimapCooldownRef.current = setTimeout(() => {
          setMinimapVisible(false);
          lastMinimapHideTime.current = 0;
        }, gpsTimeoutPeriod);
      } else {
        // Not moving fast; keep hidden until cooldown logic says otherwise
        setMinimapVisible(false);
      }
    } else if (settings.showMinimap) {
      // Always show mode
      setMinimapVisible(true);
    } else {
      // Hidden mode
      setMinimapVisible(false);
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, minimapVisible, checkGpsUpdateRate]);

  // Update settings ref whenever settings change
  useEffect(() => {
    settingsRef.current = settings;
    lastSettingsHash.current = JSON.stringify(settings);

    // Re-render location display instantly from cached raw data if available
    if (lastRawLocation.current && settings.locationDisplay !== 'hidden') {
      try {
        const formatted = formatLocation(lastRawLocation.current, settings.locationDisplay);
        setLocation({
          primary: formatted.primary || 'Unknown Location',
          context: formatted.country,
          countryCode: lastRawLocation.current.countryCode || ''
        });
      } catch {
        // Ignore formatting errors; UI will update on next normal cycle
      }
    }
  }, [settings]);

  // Update minimap visibility when relevant state changes
  useEffect(() => {
    updateMinimapVisibility();
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, updateMinimapVisibility]);

  // Cleanup minimap cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (minimapCooldownRef.current) {
        clearTimeout(minimapCooldownRef.current);
      }
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
      const cooldown = API_RATE_LIMITS.LOCATIONIQ_FREE.COOLDOWN_MS;
      
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
  const rtilSetupDone = useRef(false);

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
      OverlayLogger.overlay('DateTime formatters created', { timezone });
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
        
        setTimeDisplay({
          time: `${timePart}:${minutePart} ${ampmPart}`,
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
            setSettings(data);
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
        // Reconnect with exponential backoff and max retry limit
        const reconnectDelay = Math.min(1000 * Math.pow(2, 0), 10000); // Start with 1s, max 10s
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
    
    // Fallback polling mechanism - check for settings changes every 5 seconds
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
          const newHash = JSON.stringify(data);
          if (newHash !== lastSettingsHash.current) {
            lastSettingsHash.current = newHash;
            setSettings(data); // UI updates immediately
          }
        }
      } catch {
        // Ignore polling errors - SSE is primary, polling is fallback
      }
    }, 5000); // Check every 5 seconds
    
    // Cleanup on unmount
    return () => {
      if (eventSource) {
        eventSource.close();
      }
      clearInterval(pollingInterval);
    };
  }, []); // Empty dependency array - we want this to run once on mount

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
    if (rtilSetupDone.current) {
      return;
    }
    rtilSetupDone.current = true;

    const setupRTIRLListener = () => {
      
      
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          try {
            if (!p || typeof p !== 'object') {
              return;
            }
            const payload = p as RTIRLPayload;
          
          // Handle timezone from RTIRL
          if (payload.location?.timezone && payload.location.timezone !== timezoneRef.current) {
            try {
              createDateTimeFormattersRef.current(payload.location.timezone);
              setTimezone(payload.location.timezone);
              // Timezone ready;
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
              const loc = payload.location as { latitude: number; longitude: number };
              lat = loc.latitude;
              lon = loc.longitude;
            }
          }
          
          if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            setMapCoords([lat, lon]);
            
            // Track GPS update for minimap logic
            const now = Date.now();
            gpsUpdateTimes.current.push(now);
            
            // Get previous coordinates for distance calculation
            const prevCoords = lastCoords.current;
            const prevTime = lastCoordsTime.current;
            
            // Use RTIRL's speed if available, otherwise calculate our own
            let speedKmh = 0;
            if (typeof payload === 'object' && payload !== null && 'speed' in payload) {
              const rtirlPayload = payload as RTIRLPayload;
              if (typeof rtirlPayload.speed === 'number' && rtirlPayload.speed >= 0) {
                speedKmh = rtirlPayload.speed;
              }
            }
            
            // Fallback to calculated speed if RTIRL speed not available
            if (speedKmh === 0) {
              if (prevCoords && prevTime > 0) {
                const movedMeters = distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]);
                const timeDiffHours = (now - prevTime) / (1000 * 60 * 60);
                if (timeDiffHours > 0) {
                  speedKmh = (movedMeters / 1000) / timeDiffHours;
                }
              }
            }
            
            setCurrentSpeed(Math.round(speedKmh));
            
            lastCoords.current = [lat!, lon!];
            lastCoordsTime.current = now;
            
            // Kick off location + weather fetches on coordinate updates with gating
            (async () => {
              const movedMeters = prevCoords ? distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]) : Infinity;

              // Determine what needs to be fetched
              const weatherElapsed = now - lastWeatherTime.current;
              const locationElapsed = now - lastLocationTime.current;
              const locationThresholds = getLocationUpdateThresholds();
              const meetsDistance = movedMeters >= locationThresholds.distanceThreshold;
              
              // Weather updates every 5 minutes regardless of movement
              const shouldFetchWeather = lastWeatherTime.current === 0 || 
                weatherElapsed >= TIMERS.WEATHER_UPDATE_INTERVAL;
              
              // Debug weather timing removed for production
              
              // Location updates: always on first load, or every minute if moved threshold
              // We need country name/flag even in custom location mode
              const shouldFetchLocation = lastLocationTime.current === 0 || 
                (locationElapsed >= locationThresholds.timeThreshold && meetsDistance);
              
              // If settings just updated (hash changed), allow UI update but do not force API refetch here
              // API fetching remains purely based on the time/distance gates above

              // Fetch weather and location in parallel for faster loading
              const promises: Promise<void>[] = [];
              
              if (shouldFetchWeather && API_KEYS.OPENWEATHER) {
                promises.push(
                  (async () => {
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
                      } else {
                        setWeather(null);
                      }
                      
                      if (result.timezone && result.timezone !== timezone) {
                        createDateTimeFormatters(result.timezone);
                        setTimezone(result.timezone);
                      }
                      
                      if (result.sunriseSunset) {
                        setSunriseSunset(result.sunriseSunset);
                        OverlayLogger.overlay('Sunrise/sunset data received', { sunriseSunset: result.sunriseSunset });
                      }
                    } else {
                      // OpenWeatherMap failed, use fallbacks
                      OverlayLogger.warn('OpenWeatherMap failed, using fallbacks');
                      
                      // Use fallback weather (null = hide weather)
                      setWeather(createWeatherFallback());
                      
                      // Use fallback sunrise/sunset
                      const fallbackSunriseSunset = createSunriseSunsetFallback(timezone || undefined);
                      if (fallbackSunriseSunset) {
                        setSunriseSunset(fallbackSunriseSunset);
                      }
                    }
                  })()
                );
              }
              
              if (shouldFetchLocation) {
                promises.push(
                  (async () => {
                    let loc: LocationData | null = null;
                    
                    // Fetch location from LocationIQ
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
                    
                    lastLocationTime.current = Date.now();
                    if (loc) {
                      const formatted = formatLocation(loc, settingsRef.current.locationDisplay);
                      lastRawLocation.current = loc;
        setLocation({
          primary: formatted.primary || 'Unknown Location',
          context: formatted.country,
          countryCode: loc.countryCode || ''
        });
                    } else {
                      // LocationIQ failed, use coordinate fallback
                      OverlayLogger.warn('LocationIQ failed, using coordinate fallback');
                      
                      const fallbackLocation = createLocationWithCountryFallback(lat!, lon!);
                      setLocation({
                        primary: fallbackLocation.primary,
                        context: fallbackLocation.country,
                        countryCode: '' // No country code available from fallback
                      });
                    }
                  })()
                );
              }
              
              // Wait for all parallel requests to complete
              await Promise.all(promises);
            })();
    }
          } catch {
            // Ignore RTIRL listener errors
            // Don't break the entire component on RTIRL errors
          }
        });
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
        // Failed to load RTIRL script
      };
      script.onload = () => {
        setupRTIRLListener();
      };
      document.body.appendChild(script);
    }

    return () => {
      // RTIRL script cleanup handled automatically
    };
  }, [canMakeApiCall, createDateTimeFormatters, getLocationUpdateThresholds, safeApiCall, timezone, trackApiCall]); // Include dependencies; guarded by rtilSetupDone

  // Overlay visibility - wait for all elements to be ready with timeout fallback
  const isOverlayReady = useMemo(() => {
    // Time and timezone must be ready
    const timeReady = timezone && timeDisplay.time && timeDisplay.date;
    
    // Location must be ready (unless hidden) - allow fallback to "Unknown Location"
    const locationReady = settings.locationDisplay === 'hidden' || 
      (settings.locationDisplay === 'custom' ? settings.customLocation?.trim() : location) ||
      loadingTimeout; // Show overlay even if location failed after timeout
    
    // Weather must be ready (unless hidden) - allow fallback to no weather
    const weatherReady = settings.locationDisplay === 'hidden' || weather || loadingTimeout;
    
    // Flag is always ready since we show emoji fallback immediately
    const flagReady = true;
    
    return timeReady && locationReady && weatherReady && flagReady;
  }, [timezone, timeDisplay, settings, location, weather, loadingTimeout]);

  // Timeout fallback - show overlay after 10 seconds even if some elements failed
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!overlayVisible) {
        setLoadingTimeout(true);
        OverlayLogger.warn('Overlay loading timeout - showing with available elements only');
      }
    }, 10000); // 10 second timeout
    
    return () => clearTimeout(timeout);
  }, [overlayVisible]);

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      // Wait 0.5 seconds for all elements to be ready, then fade in
      const delay = setTimeout(() => setOverlayVisible(true), 500);
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);

  // Check for sunrise/sunset changes every 2 minutes to update weather icon
  useEffect(() => {
    if (!mapCoords || !timezone) return;

    // Check every 2 minutes (reduced frequency for production)
    const interval = setInterval(() => {
      setDayNightTrigger(prev => prev + 1);
    }, 120000); // 120 seconds (2 minutes)

    return () => clearInterval(interval);
  }, [mapCoords, timezone]);

  // Monitor API health (less frequent in production)
  useEffect(() => {
    const interval = setInterval(() => {
      const health = getOverallHealth();
      setApiHealth(health);
    }, 60000); // Check every 60 seconds (reduced from 30s)
    
    return () => clearInterval(interval);
  }, []);

  // Memoized display values
  const locationDisplay = useMemo(() => {
    if (settings.locationDisplay === 'hidden') {
      return null;
    }
    
    if (settings.locationDisplay === 'custom') {
      return {
        primary: settings.customLocation?.trim() || '',
        context: location?.context, // Show the actual country name
        countryCode: location?.countryCode?.toUpperCase()
      };
    }
    
    // Always show something for location display
    if (location) {
      return {
        ...location,
        countryCode: location.countryCode?.toUpperCase()
      };
    }
    
    // Fallback when no location data
    return {
      primary: 'Unknown Location',
      context: undefined,
      countryCode: undefined
    };
  }, [location, settings.locationDisplay, settings.customLocation]);


  // Accurate day/night check using OpenWeatherMap sunrise/sunset data
  const isNightTime = useCallback((): boolean => {
    if (!sunriseSunset) {
      // Fallback to simple time-based check if no API data
      OverlayLogger.warn('No sunrise/sunset data available, using fallback detection');
      return isNightTimeFallback(timezone || undefined);
    }
    
    try {
      // Parse sunrise and sunset times (OpenWeatherMap provides them in UTC)
      const sunriseUTC = new Date(sunriseSunset.sunrise);
      const sunsetUTC = new Date(sunriseSunset.sunset);
      
      // Get current time in the location's timezone
      const now = new Date();
      const currentTimeStr = now.toLocaleString('en-US', { 
        timeZone: timezone || 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Parse current time in local timezone
      const [hours, minutes] = currentTimeStr.split(':');
      const currentHour = parseInt(hours);
      const currentMinute = parseInt(minutes);
      
      // Convert sunrise/sunset to local timezone for comparison
      const sunriseLocal = sunriseUTC.toLocaleString('en-US', { 
        timeZone: timezone || 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const sunsetLocal = sunsetUTC.toLocaleString('en-US', { 
        timeZone: timezone || 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Parse sunrise/sunset times in local timezone
      const [sunriseHour, sunriseMin] = sunriseLocal.split(':');
      const [sunsetHour, sunsetMin] = sunsetLocal.split(':');
      
      // Convert to minutes since midnight for easier comparison
      const sunriseMinutes = parseInt(sunriseHour) * 60 + parseInt(sunriseMin);
      const sunsetMinutes = parseInt(sunsetHour) * 60 + parseInt(sunsetMin);
      const currentMinutes = currentHour * 60 + currentMinute;
      
      const isNight = currentMinutes < sunriseMinutes || currentMinutes > sunsetMinutes;
      
      // Debug logging removed for production
      
      return isNight;
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
      return null;
    }
    
    return {
      temperature: `${weather.temp}°C / ${celsiusToFahrenheit(weather.temp)}°F`,
      icon: getWeatherIcon(weather.desc)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, getWeatherIcon, dayNightTrigger]); // dayNightTrigger intentionally included to force recalc on sunrise/sunset

  return (
    <ErrorBoundary>
      <div 
        className="overlay-container"
        style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.8s ease-in-out'
        }}
      >
        <div className="top-left">
          <div className="overlay-box">
            {timezone && timeDisplay.time && (
              <div className="time time-left">
                <div className="time-display">
                  <span className="time-value">{timeDisplay.time.split(' ')[0]}</span>
                  <span className="time-period">{timeDisplay.time.split(' ')[1]}</span>
                </div>
              </div>
            )}
            
            {timezone && timeDisplay.date && (
              <div className="date date-left">
                {timeDisplay.date}
              </div>
            )}
            
            {API_KEYS.PULSOID && (
              <ErrorBoundary fallback={<div>Heart rate unavailable</div>}>
                <HeartRateMonitor 
                  pulsoidToken={API_KEYS.PULSOID} 
                />
              </ErrorBoundary>
            )}
          </div>
        </div>

        <div className="top-right">
          {settings.locationDisplay !== 'hidden' && (
          <div className="overlay-box">
            {locationDisplay && (
              <div className="location">
                <div className="location-text">
                  <div className="location-main">{locationDisplay.primary}</div>
                  {locationDisplay.context && (
                    // Only show country name/flag if:
                    // 1. Not in custom mode (always show for GPS modes), OR
                    // 2. In custom mode AND showCountryName is enabled
                    (settings.locationDisplay !== 'custom' || settings.showCountryName) && (
                      <div className="location-sub">
                        {locationDisplay.context}
                        {locationDisplay.countryCode && (
                          <span className="location-flag-inline">
                            {flagLoaded ? (
                              <img
                                src={`https://flagcdn.com/${locationDisplay.countryCode.toLowerCase()}.svg`}
                                alt={`Country: ${locationDisplay.countryCode}`}
                                width={28}
                                height={18}
                                className="location-flag-small"
                              />
                            ) : (
                              <span 
                                className="location-flag-emoji-small"
                                style={{ fontSize: '16px', lineHeight: '16px' }}
                                title={`Country: ${locationDisplay.countryCode}`}
                              >
                                {getEmojiFlag(locationDisplay.countryCode)}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
            
            {weatherDisplay && settings.showWeather && (
              <div className="weather">
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

          {mapCoords && minimapVisible && (
            <div className="minimap">
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

          {/* API Status Indicator (only show when there are issues) */}
          {!apiHealth.isHealthy && (
            <div className="api-status-indicator">
              <span className="api-status-icon">⚠️</span>
              <span className="api-status-text">
                {apiHealth.unhealthyApis.length === 1 
                  ? `${apiHealth.unhealthyApis[0]} unavailable` 
                  : `${apiHealth.unhealthyApis.length} APIs unavailable`
                }
              </span>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
