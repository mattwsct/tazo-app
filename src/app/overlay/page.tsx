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
  const [timeDisplay, setTimeDisplay] = useState({ time: '', date: '' });
  const [location, setLocation] = useState<{ 
    primary: string; 
    context?: string;
    countryCode?: string;
  } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastCoords = useRef<[number, number] | null>(null);
  const lastCoordsTime = useRef(0);
  const settingsRef = useRef(settings);
  
  // API rate limiting tracking (per-second only)
  const lastLocationIqCall = useRef(0);
  const lastMapboxCall = useRef(0);
  
  
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

  // Simple location update thresholds
  const getLocationUpdateThresholds = useCallback(() => {
    return {
      distanceThreshold: THRESHOLDS.LOCATION_DISTANCE_DEFAULT,
      timeThreshold: 300000, // 5 minutes
    };
  }, []);

  // Check API rate limits (per-second cooldown only)
  const canMakeApiCall = useCallback((apiType: 'locationiq' | 'mapbox') => {
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
    } else if (apiType === 'mapbox') {
      const timeSinceLastCall = now - lastMapboxCall.current;
      const cooldown = API_RATE_LIMITS.MAPBOX_FREE.COOLDOWN_MS;
      
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

  // Track API call (update last call time only)
  const trackApiCall = useCallback((apiType: 'locationiq' | 'mapbox') => {
    const now = Date.now();
    if (apiType === 'locationiq') {
      lastLocationIqCall.current = now;
    } else if (apiType === 'mapbox') {
      lastMapboxCall.current = now;
    }
  }, []);




  

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
    
    // Set up Server-Sent Events for real-time updates
    const setupSSE = () => {
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

  // Fallback location fetch if RTIRL is slow (after 3 seconds)
  useEffect(() => {
    const fallbackTimer = setTimeout(async () => {
      // Only fetch if we still don't have location and RTIRL hasn't provided coords
      if (!location && !lastCoords.current) {
        OverlayLogger.overlay('RTIRL slow - attempting fallback location fetch');
        
        // Try to get approximate location from browser geolocation as fallback
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const { latitude, longitude } = position.coords;
              lastCoords.current = [latitude, longitude];
              
              // Fetch location data
              let loc: LocationData | null = null;
              
              if (API_KEYS.LOCATIONIQ && canMakeApiCall('locationiq')) {
                trackApiCall('locationiq');
                const locationResult = await safeApiCall(
                  () => fetchLocationFromLocationIQ(latitude, longitude, API_KEYS.LOCATIONIQ!),
                  'LocationIQ fallback fetch'
                );
                if (locationResult && typeof locationResult === 'object') {
                  loc = locationResult as LocationData;
                }
              }
              
              if (!loc && API_KEYS.MAPBOX && canMakeApiCall('mapbox')) {
                trackApiCall('mapbox');
                const mapboxResult = await safeApiCall(
                  () => fetchLocationFromMapbox(latitude, longitude, API_KEYS.MAPBOX!),
                  'Mapbox fallback fetch'
                );
                if (mapboxResult && typeof mapboxResult === 'object') {
                  loc = mapboxResult as LocationData;
                }
              }
              
              if (loc) {
                const formatted = formatLocation(loc, settingsRef.current.locationDisplay);
                setLocation({
                  primary: formatted.primary,
                  context: formatted.context,
                  countryCode: loc.countryCode || ''
                });
                lastLocationTime.current = Date.now();
                OverlayLogger.overlay('Fallback location loaded', { location: formatted });
              }
            },
            () => {
              OverlayLogger.warn('Browser geolocation fallback failed');
            },
            { timeout: 5000, enableHighAccuracy: false }
          );
        }
      }
    }, 3000);
    
    return () => clearTimeout(fallbackTimer);
  }, [location, safeApiCall, canMakeApiCall, trackApiCall]);

  // RTIRL connection
  useEffect(() => {
    let listenerSetup = false;
    
    const setupRTIRLListener = () => {
      if (listenerSetup) {
        return;
      }
      
      
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        listenerSetup = true;
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
              
              const thresholds = getLocationUpdateThresholds();
              
              // Simple location update logic
              const meetsDistance = movedMeters >= thresholds.distanceThreshold;
              const shouldFetchLocation = lastLocationTime.current === 0 || 
                (locationElapsed >= thresholds.timeThreshold && meetsDistance);
              

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
                    primary: formatted.primary,
                    context: formatted.context,
                    countryCode: loc.countryCode || ''
                  });
                  
                } else {
                  OverlayLogger.warn('Location fetch failed - both APIs unavailable or rate limited', {
                    locationIqAvailable: canMakeApiCall('locationiq'),
                    mapboxAvailable: canMakeApiCall('mapbox')
                  });
                }
              }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No dependencies - use refs instead to prevent duplicate listeners

  // Overlay visibility with fade-in delay - don't wait for location
  const isOverlayReady = useMemo(() => timezone && timeDisplay.time && timeDisplay.date, [timezone, timeDisplay]);

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      // Wait 1 second for time/timezone to be ready, then fade in immediately
      const delay = setTimeout(() => setOverlayVisible(true), 1000);
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
        context: undefined,
        countryCode: location?.countryCode
      };
    }
    
    return location;
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
                        alt={`Country: ${locationDisplay.countryCode}`}
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
