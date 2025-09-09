"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import { OverlayLogger } from '@/lib/logger';
import { celsiusToFahrenheit } from '@/utils/unit-conversions';
import { API_KEYS, THRESHOLDS, TIMERS, type RTIRLPayload } from '@/utils/overlay-constants';
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

  // Health monitoring - detect when updates stop
  useEffect(() => {
    const healthCheck = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      
      if (timeSinceLastUpdate > 120000) { // 2 minutes without update
        OverlayLogger.warn('Overlay appears unhealthy - no updates for 2+ minutes', {
          timeSinceLastUpdate,
          lastUpdate: new Date(lastUpdateTime).toISOString()
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
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(healthCheck);
  }, [lastUpdateTime]);

  // Update lastUpdateTime whenever time updates
  useEffect(() => {
    setLastUpdateTime(Date.now());
  }, [time, date]);

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

  // Time and date updates - simplified and more robust
  useEffect(() => {
    if (!timezone || !timeFormatter.current || !dateFormatter.current) return;
    
    let isActive = true;
    
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
    
    // Update immediately
    updateTimeAndDate();
    
    // Set up simple interval - update every minute
    const interval = setInterval(updateTimeAndDate, 60000);
    timeUpdateTimer.current = interval;
    
    return () => {
      isActive = false;
      clearInterval(interval);
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
        eventSource.close();
        // Reconnect with exponential backoff
        const reconnectDelay = Math.min(1000 * Math.pow(2, 0), 10000); // Start with 1s, max 10s
        setTimeout(() => {
          OverlayLogger.settings('Reconnecting SSE...');
          setupSSE();
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
              const minTimeBetweenCalls = isStationary ? 30000 : 15000; // 30s if stationary, 15s if moving
              const meetsDistance = movedMeters >= THRESHOLDS.LOCATION_DISTANCE;
              const shouldFetchLocation = lastLocationTime.current === 0 || (locationElapsed >= minTimeBetweenCalls && meetsDistance);
              
              // Debug location caching
              if (process.env.NODE_ENV === 'development') {
                OverlayLogger.overlay('Location fetch decision', {
                  movedMeters,
                  isStationary,
                  locationElapsed,
                  minTimeBetweenCalls,
                  meetsDistance,
                  shouldFetchLocation,
                  lastLocationTime: lastLocationTime.current
                });
              }

              if (shouldFetchLocation) {
                let loc: LocationData | null = null;
                
                // Try LocationIQ first
                if (API_KEYS.LOCATIONIQ) {
                  const locationResult = await safeApiCall(
                    () => fetchLocationFromLocationIQ(lat!, lon!, API_KEYS.LOCATIONIQ!),
                    'LocationIQ fetch'
                  );
                  if (locationResult && typeof locationResult === 'object') {
                    loc = locationResult as LocationData;
                  }
                }
                
                // Fallback to Mapbox if LocationIQ failed
                if (!loc && API_KEYS.MAPBOX) {
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
