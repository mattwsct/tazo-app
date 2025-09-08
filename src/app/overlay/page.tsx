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

// MapboxMinimap component (currently unused but kept for future use)
// const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
//   ssr: false,
//   loading: () => <div className="minimap-placeholder" />
// });

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
  // const [mapCoords, setMapCoords] = useState<[number, number] | null>(null); // Currently unused but kept for future use
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  // Removed isLoading state - using Option 1: hide until ready

  // Rate-gating refs for external API calls
  const lastWeatherTime = useRef(0);
  const lastLocationTime = useRef(0);
  const lastCoords = useRef<[number, number] | null>(null);
  const settingsRef = useRef(settings);
  
  // Update settings ref whenever settings change
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  
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

  // Time and date updates
  useEffect(() => {
    if (!timezone || !timeFormatter.current || !dateFormatter.current) return;
    
    function updateTimeAndDate() {
      const now = new Date();
      const timeParts = timeFormatter.current!.formatToParts(now);
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
        
        timeUpdateTimer.current = interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    return () => {
      clearTimeout(timeout);
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
        // Reconnect after 5 seconds
        setTimeout(() => {
          OverlayLogger.settings('Reconnecting SSE...');
          setupSSE();
        }, 5000);
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
            // setMapCoords([lat, lon]); // Currently unused but kept for future use
            // Kick off location + weather fetches on coordinate updates with gating
            (async () => {
              const now = Date.now();
              const prevCoords = lastCoords.current;
              const movedMeters = prevCoords ? distanceInMeters(lat!, lon!, prevCoords[0], prevCoords[1]) : Infinity;
              lastCoords.current = [lat!, lon!];

              // WEATHER: fetch immediately on first fix or large move; else respect interval
              const weatherElapsed = now - lastWeatherTime.current;
              const largeMove = movedMeters >= THRESHOLDS.WEATHER_DISTANCE_KM * 1000;
              const shouldFetchWeather = lastWeatherTime.current === 0 || largeMove || weatherElapsed >= TIMERS.WEATHER_TIMEZONE_UPDATE;
              try {
                if (shouldFetchWeather) {
                  // Starting weather fetch;
                  const weatherResult = await fetchWeatherAndTimezoneFromOpenMeteo(lat!, lon!);
                  lastWeatherTime.current = Date.now();
                  if (weatherResult) {
                    if (weatherResult.weather) {
                      setWeather(weatherResult.weather);
                      // Weather fetch complete;
                    } else {
                      setWeather(null);
                      // Weather fetch complete;
                    }
                    if (weatherResult.timezone && weatherResult.timezone !== timezone) {
                      createDateTimeFormatters(weatherResult.timezone);
                      setTimezone(weatherResult.timezone);
                      // Timezone ready;
                    }
                  } else {
                    setWeather(null);
                    // Weather fetch complete;
                  }
                }
              } catch (err) {
                OverlayLogger.error('Weather fetch failed', err);
                // Weather fetch complete;
              }

              try {
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
                  // Starting location fetch;
                  let loc: LocationData | null = null;
                  if (API_KEYS.LOCATIONIQ) {
                    loc = await fetchLocationFromLocationIQ(lat!, lon!, API_KEYS.LOCATIONIQ);
                  }
                  if (!loc && API_KEYS.MAPBOX) {
                    loc = await fetchLocationFromMapbox(lat!, lon!, API_KEYS.MAPBOX);
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
                  // Location fetch complete;
                }
              } catch (err) {
                OverlayLogger.error('Location fetch failed', err);
                // Location fetch complete;
              }
            })();
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
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
