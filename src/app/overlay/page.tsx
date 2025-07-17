"use client";

// Add global declaration at the very top
declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { authenticatedFetch, createAuthenticatedEventSource } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { 
  fetchWeatherAndTimezoneFromOpenMeteo,
  fetchLocationFromLocationIQ,
} from '@/utils/api-utils';
import {
  formatLocation,
  distanceInMeters,
  isValidCoordinate,
  hasLatLon,
  hasLatitudeLongitude,
  capitalizeWords,
  type LocationData
} from '@/utils/overlay-utils';
import HeartRateMonitor from '@/components/HeartRateMonitor';
import dynamic from 'next/dynamic';
const LeafletMinimap = dynamic(() => import('@/components/LeafletMinimap'), {
  ssr: false,
  loading: () => <div className="minimap-placeholder" />
});

// === 🎯 CONFIGURATION CONSTANTS ===
const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes - combined weather+timezone from API
  LOCATION_UPDATE: 60000, // 1 minute max - also triggers on 100m movement
  DATA_REFRESH_FALLBACK: 30000, // 30 seconds - fallback syncing
  OVERLAY_FADE_TIMEOUT: 10000, // 10 seconds to force fade-in
  MINIMAP_HIDE_DELAY: 120000, // 2 minutes - hide minimap if no GPS data
  SPEED_HIDE_DELAY: 10000, // 10 seconds - hide speed when below threshold
} as const;

const THRESHOLDS = {
  LOCATION_DISTANCE: 100, // 100 meters - triggers location update
  SPEED_SHOW: 10, // 10 km/h - show speed-based minimap
  SPEED_READINGS_REQUIRED: 3, // 3 successive readings above threshold
} as const;

// === 🔑 API CONFIGURATION ===
const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

// === 📊 LOGGING UTILITIES ===
const Logger = {
  overlay: (message: string, data?: unknown) => 
    console.log(`🎮 [OVERLAY] ${message}`, data || ''),
  
  weather: (message: string, data?: unknown) => 
    console.log(`🌤️ [WEATHER] ${message}`, data || ''),
  
  location: (message: string, data?: unknown) => 
    console.log(`📍 [LOCATION] ${message}`, data || ''),
  
  settings: (message: string, data?: unknown) => 
    console.log(`⚙️ [SETTINGS] ${message}`, data || ''),
  
  error: (message: string, error?: unknown) => 
    console.error(`❌ [ERROR] ${message}`, error || ''),
  
  warn: (message: string, data?: unknown) => 
    console.warn(`⚠️ [WARNING] ${message}`, data || ''),
} as const;

// === 🌍 DATA INTERFACES ===
interface RTIRLWeather {
  temp: number;
  icon: string;
  desc: string;
}

interface RTIRLPayload {
  speed?: number;
  weather?: RTIRLWeather;
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
}

// === 🎮 MAIN OVERLAY COMPONENT ===
export default function OverlayPage() {
  Logger.overlay('Initializing streaming overlay');

  // Add overlay-page class to body for page-specific CSS
  useEffect(() => {
    document.body.classList.add('overlay-page');
    Logger.overlay('Added overlay-page CSS class to body');
    return () => {
      document.body.classList.remove('overlay-page');
    };
  }, []);

  // === 🎭 OVERLAY STATE ===
  const [showOverlay, setShowOverlay] = useState(false);
  const [time, setTime] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  
  // Validation flags
  const [validWeather, setValidWeather] = useState(false);
  const [validLocation, setValidLocation] = useState(false);
  const [validTimezone, setValidTimezone] = useState(false);
  const [firstWeatherChecked, setFirstWeatherChecked] = useState(false);
  const [firstLocationChecked, setFirstLocationChecked] = useState(false);
  const [firstTimezoneChecked, setFirstTimezoneChecked] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);

  // Minimap state
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);

  // Refs for timers and tracking
  const lastAPICoords = useRef<[number, number] | null>(null);
  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastWeatherUpdate = useRef(0);
  const lastLocationUpdate = useRef(0);
  const lastTimezoneUpdate = useRef(0);
  const weatherRefreshTimer = useRef<NodeJS.Timeout | null>(null);
  const minimapTimeout = useRef<NodeJS.Timeout | null>(null);
  const overlayShown = useRef(false);
  
  // Speed-based minimap refs
  const speedBasedVisible = useRef(false);
  const speedAboveThresholdCount = useRef(0);
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // Time formatter
  const formatter = useRef<Intl.DateTimeFormat | null>(null);

  // === 🗺️ MINIMAP VISIBILITY LOGIC ===
  const shouldShowMinimap = () => {
    if (!mapCoords) return false;
    const manualShow = settings.showMinimap;
    const speedBasedShow = settings.minimapSpeedBased && speedBasedVisible.current;
    return manualShow || speedBasedShow;
  };

  // === 👁️ OVERLAY VISIBILITY LOGIC ===
  const hasVisibleElements = (
    (settings.showTime && validTimezone) ||
    (settings.showLocation && validLocation) ||
    (settings.showWeather && validWeather) ||
    shouldShowMinimap()
  );

  // === ⏰ TIME MANAGEMENT ===
  useEffect(() => {
    if (!timezone || !formatter.current) return;
    
    function updateTime() {
      const now = new Date();
      setTime(formatter.current!.format(now));
    }
    
    // Update immediately
    updateTime();
    
    function setupNextSync() {
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
      // Set timeout to sync with the next minute boundary
      const syncTimeout = setTimeout(() => {
        updateTime();
        Logger.overlay('Time updated on minute boundary');
        
        // Set regular interval for the next hour, then re-sync
        let updateCount = 0;
        const interval = setInterval(() => {
          updateTime();
          updateCount++;
          
          // Re-sync every hour (60 updates) to prevent drift
          if (updateCount >= 60) {
            clearInterval(interval);
            Logger.overlay('Hourly time sync - setting up next cycle');
            setupNextSync();
          }
        }, 60000);
        
        return interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    
    return () => {
      clearTimeout(timeout);
    };
  }, [timezone]);

  // === 🌤️ WEATHER & TIMEZONE REFRESH TIMER ===
  useEffect(() => {
    async function doWeatherUpdate() {
      if (lastWeatherCoords.current) {
        const [lat, lon] = lastWeatherCoords.current;
        Logger.weather('Performing scheduled weather/timezone update', { lat, lon });
        
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result) {
          // Update weather if available
          if (result.weather) {
            setWeather(result.weather);
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
            Logger.weather('Weather data updated successfully', result.weather);
          }
          
          // Update timezone if available and different
          if (result.timezone && result.timezone !== timezone) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: result.timezone,
              });
              setTimezone(result.timezone);
              setValidTimezone(true);
              setFirstTimezoneChecked(true);
              lastTimezoneUpdate.current = Date.now();
              Logger.overlay('Timezone updated successfully', { timezone: result.timezone });
            } catch (error) {
              Logger.error('Failed to set timezone', error);
              setValidTimezone(false);
              setFirstTimezoneChecked(true);
            }
          }
        }
      }
    }
    
    if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    weatherRefreshTimer.current = setInterval(doWeatherUpdate, TIMERS.WEATHER_TIMEZONE_UPDATE);
    
    return () => {
      if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    };
  }, [timezone, setWeather, setValidWeather, setFirstWeatherChecked, setTimezone, setValidTimezone, setFirstTimezoneChecked]);

  // === 📍 LOCATION UPDATE LOGIC ===
  const updateFromCoordinates = useCallback(async (lat: number, lon: number) => {
    if (!isValidCoordinate(lat, lon)) {
      Logger.error('Invalid coordinates received', { lat, lon });
      return;
    }
    
    // Store coordinates for timer-based weather/timezone updates
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    // If first time getting coordinates, do immediate weather update
    if (!hadCoords && !firstWeatherChecked) {
      Logger.weather('First coordinates received - fetching immediate weather update');
      try {
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result?.weather) {
          setWeather(result.weather);
          setValidWeather(true);
          setFirstWeatherChecked(true);
          lastWeatherUpdate.current = Date.now();
          Logger.weather('Initial weather data loaded', result.weather);
        }
        
        if (result?.timezone && result.timezone !== timezone) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: result.timezone,
            });
            setTimezone(result.timezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
            lastTimezoneUpdate.current = Date.now();
            Logger.overlay('Initial timezone set', { timezone: result.timezone });
          } catch (error) {
            Logger.error('Failed to set initial timezone', error);
            setValidTimezone(false);
            setFirstTimezoneChecked(true);
          }
        }
      } catch (error) {
        Logger.error('Immediate weather update failed', error);
      }
    }
    
    // Check location update: only on significant movement AND respecting rate limit
    const now = Date.now();
    let shouldUpdateLocation = false;
    
    if (lastAPICoords.current) {
      const distanceMoved = distanceInMeters(lat, lon, lastAPICoords.current[0], lastAPICoords.current[1]);
      const timeSinceLastUpdate = now - lastLocationUpdate.current;
      
      // Update only if: moved 100m+ AND at least 1 minute since last update
      shouldUpdateLocation = distanceMoved >= THRESHOLDS.LOCATION_DISTANCE && 
                           timeSinceLastUpdate >= TIMERS.LOCATION_UPDATE;
      
      if (shouldUpdateLocation) {
        Logger.location(`Significant movement detected: ${distanceMoved.toFixed(0)}m after ${(timeSinceLastUpdate / 1000).toFixed(0)}s`);
      }
    } else {
      // First update
      shouldUpdateLocation = true;
      Logger.location('First location update');
    }
    
    if (!shouldUpdateLocation) {
      return;
    }
    
    lastAPICoords.current = [lat, lon];
    
    // Update location name from LocationIQ
    if (API_KEYS.LOCATIONIQ) {
      const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
      if (loc) {
        const label = formatLocation(loc);
        setLocation({ label, countryCode: loc.countryCode || '' });
        setValidLocation(true);
        setFirstLocationChecked(true);
        lastLocationUpdate.current = now;
        Logger.location('Location name updated', { label, countryCode: loc.countryCode });
        
        // Use timezone from LocationIQ as fallback
        if (loc.timezone && loc.timezone !== timezone) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: loc.timezone,
            });
            setTimezone(loc.timezone);
            setValidTimezone(true);
            setFirstTimezoneChecked(true);
            lastTimezoneUpdate.current = now;
            Logger.overlay('Timezone updated from LocationIQ', { timezone: loc.timezone });
          } catch (error) {
            Logger.error('Failed to set timezone from LocationIQ', error);
            setValidTimezone(false);
            setFirstTimezoneChecked(true);
          }
        }
      }
    }
  }, [timezone, firstWeatherChecked]); // Add dependencies for the callback

  // === 📡 RTIRL INTEGRATION ===
  useEffect(() => {
    Logger.overlay('Initializing RealtimeIRL integration');
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
    script.async = true;
    document.body.appendChild(script);
    
    script.onload = () => {
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        Logger.overlay('RealtimeIRL API loaded, setting up listener');
        
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          if (!p || typeof p !== 'object') return;
          const payload = p as RTIRLPayload;
          
          // Speed tracking for minimap
          if (typeof payload.speed === 'number') {
            setSpeed(payload.speed);
            Logger.overlay(`Speed update: ${payload.speed.toFixed(1)} m/s (${(payload.speed * 3.6).toFixed(1)} km/h)`);
          }
          
          // Weather data
          if (payload.weather && 
              typeof payload.weather.temp === 'number' &&
              payload.weather.icon && 
              payload.weather.desc) {
            const weatherData = {
              temp: Math.round(payload.weather.temp),
              icon: payload.weather.icon,
              desc: payload.weather.desc,
            };
            setWeather(weatherData);
            setValidWeather(true);
            setFirstWeatherChecked(true);
            lastWeatherUpdate.current = Date.now();
            Logger.weather('Weather data received from RTIRL', weatherData);
          }
          
          // Location data
          if (payload.location) {
            const label = formatLocation(payload.location);
            const countryCode = payload.location.countryCode ? payload.location.countryCode.toLowerCase() : '';
            if (label && countryCode) {
              setLocation({ label, countryCode });
              setValidLocation(true);
              setFirstLocationChecked(true);
              lastLocationUpdate.current = Date.now();
              Logger.location('Location data received from RTIRL', { label, countryCode });
            }
          }
          
          // Timezone data
          if (payload.location?.timezone && payload.location.timezone !== timezone) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: payload.location.timezone,
              });
              setTimezone(payload.location.timezone);
              setValidTimezone(true);
              setFirstTimezoneChecked(true);
              lastTimezoneUpdate.current = Date.now();
              Logger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
            } catch (error) {
              Logger.error('Failed to set timezone from RTIRL', error);
              setValidTimezone(false);
              setFirstTimezoneChecked(true);
            }
          }
          
          // GPS coordinates
          let lat: number | null = null;
          let lon: number | null = null;
          if (payload.location) {
            if (hasLatLon(payload.location)) {
              lat = payload.location.lat;
              lon = payload.location.lon;
            } else if (hasLatitudeLongitude(payload.location)) {
              const loc = payload.location as LocationData;
              lat = loc.latitude ?? null;
              lon = loc.longitude ?? null;
            }
          }
          
          if (lat !== null && lon !== null && isValidCoordinate(lat, lon)) {
            Logger.overlay('GPS coordinates received', { lat, lon });
            updateFromCoordinates(lat, lon);
            
            // Update minimap coordinates
            setMapCoords([lat, lon]);
            
            // Clear existing timeout and set new one
            if (minimapTimeout.current) {
              clearTimeout(minimapTimeout.current);
            }
            minimapTimeout.current = setTimeout(() => {
              Logger.overlay('GPS data timeout - hiding minimap');
              setMapCoords(null);
            }, TIMERS.MINIMAP_HIDE_DELAY);
          }
        });
      } else {
        Logger.warn('RealtimeIRL API not available or missing API key');
      }
    };
    
    return () => {
      document.body.removeChild(script);
    };
  }, [updateFromCoordinates]); // Add updateFromCoordinates dependency

  // === 🎭 OVERLAY FADE-IN LOGIC ===
  useEffect(() => {
    if (!overlayShown.current &&
        firstWeatherChecked &&
        firstLocationChecked &&
        firstTimezoneChecked &&
        validWeather &&
        validLocation &&
        validTimezone) {
      Logger.overlay('All data ready - showing overlay');
      setShowOverlay(true);
      overlayShown.current = true;
    }
  }, [firstWeatherChecked, firstLocationChecked, firstTimezoneChecked, validWeather, validLocation, validTimezone]);

  // Force fade-in after timeout
  useEffect(() => {
    if (!overlayShown.current) {
      const timeout = setTimeout(() => {
        Logger.overlay('Timeout reached - forcing overlay to show');
        setShowOverlay(true);
        overlayShown.current = true;
      }, TIMERS.OVERLAY_FADE_TIMEOUT);
      return () => clearTimeout(timeout);
    }
  }, []);

  // === 🎛️ SETTINGS MANAGEMENT ===
  // (Settings SSE logic remains the same but with better logging)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    let isPolling = false;
    let pollingInterval: NodeJS.Timeout | null = null;
    
    function startPolling() {
      if (isPolling) return;
      isPolling = true;
      Logger.settings('Starting polling fallback for settings');
      
      pollingInterval = setInterval(() => {
        authenticatedFetch('/api/get-settings')
          .then(res => res.json())
          .then(data => {
            Logger.settings('Settings loaded via polling', data);
            setSettings(data);
            
            // Try to reconnect SSE every 10 polling cycles
            if (reconnectAttempts % 10 === 0) {
              Logger.settings('Attempting to restore SSE connection');
              stopPolling();
              reconnectAttempts = 0;
              connectSSE();
            }
          })
          .catch(err => Logger.error('Polling failed to load settings', err));
      }, 5000);
    }
    
    function stopPolling() {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      isPolling = false;
    }
    
    function connectSSE() {
      Logger.settings('Setting up SSE connection for real-time settings');
      
      // Load settings immediately as fallback
      authenticatedFetch('/api/get-settings')
        .then(res => res.json())
        .then(data => {
          Logger.settings('Initial settings loaded before SSE', data);
          setSettings(data);
        })
        .catch(err => Logger.error('Failed to load initial settings', err));
      
      if (eventSource) {
        eventSource.close();
      }
      
      eventSource = createAuthenticatedEventSource('/api/settings-stream');
      
      eventSource.onopen = () => {
        Logger.settings('SSE connection established successfully');
        reconnectAttempts = 0;
        stopPolling();
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'heartbeat') {
            return; // Ignore heartbeat messages
          }
          
          if (data.type === 'settings_update') {
            const latency = Date.now() - (data.timestamp || 0);
            Logger.settings(`Real-time settings update received (${latency}ms latency)`, data);
            
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { timestamp, type, ...settingsOnly } = data;
            setSettings(settingsOnly);
            return;
          }
          
          // Legacy format
          Logger.settings('Settings update received (legacy format)', data);
          setSettings(data);
        } catch (error) {
          Logger.error('Failed to parse settings update', error);
        }
      };
      
      eventSource.onerror = (error) => {
        Logger.error(`SSE connection error (ReadyState: ${eventSource?.readyState})`, error);
        
        if (eventSource?.readyState === EventSource.CLOSED || 
            eventSource?.readyState === EventSource.CONNECTING) {
          Logger.settings('SSE connection lost - attempting reconnection');
          
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), 30000);
          Logger.settings(`Reconnecting SSE in ${delay}ms (attempt ${reconnectAttempts})`);
          
          if (reconnectAttempts >= 3 && !isPolling) {
            startPolling();
          }
          
          reconnectTimeout = setTimeout(() => {
            connectSSE();
          }, delay);
        }
      };
    }
    
    connectSSE();
    
    return () => {
      Logger.settings('Cleaning up SSE connection and polling');
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      stopPolling();
    };
  }, []);

  // === 🏃‍♂️ SPEED-BASED MINIMAP LOGIC ===
  useEffect(() => {
    if (!settings.minimapSpeedBased) {
      speedBasedVisible.current = false;
      speedAboveThresholdCount.current = 0;
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
      return;
    }

    const kmh = speed * 3.6;
    
    if (kmh >= THRESHOLDS.SPEED_SHOW) {
      speedAboveThresholdCount.current++;
      
      if (speedAboveThresholdCount.current >= THRESHOLDS.SPEED_READINGS_REQUIRED) {
        if (!speedBasedVisible.current) {
          Logger.overlay(`Speed threshold reached - showing minimap (${kmh.toFixed(1)} km/h)`);
          speedBasedVisible.current = true;
        }
        
        if (speedHideTimeout.current) {
          clearTimeout(speedHideTimeout.current);
          speedHideTimeout.current = null;
        }
      }
    } else {
      speedAboveThresholdCount.current = 0;
      
      if (speedBasedVisible.current && !speedHideTimeout.current) {
        speedHideTimeout.current = setTimeout(() => {
          Logger.overlay(`Speed below threshold - hiding minimap (${kmh.toFixed(1)} km/h)`);
          speedBasedVisible.current = false;
          speedHideTimeout.current = null;
        }, TIMERS.SPEED_HIDE_DELAY);
      }
    }
  }, [speed, settings.minimapSpeedBased]);

  // === 🌅 INITIAL STATE SETUP ===
  useEffect(() => {
    Logger.overlay('Setting up initial overlay state');
    
    // Set initial browser timezone as fallback
    if (!timezone) {
      try {
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        formatter.current = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: browserTimezone,
        });
        setTimezone(browserTimezone);
        setValidTimezone(true);
        setFirstTimezoneChecked(true);
        Logger.overlay('Browser timezone set as fallback', { timezone: browserTimezone });
      } catch (error) {
        Logger.error('Failed to set browser timezone', error);
        setFirstTimezoneChecked(true);
      }
    }
  }, [timezone]);

  // === 🎨 RENDER OVERLAY ===
  return (
    <div 
      id="overlay" 
      className={showOverlay && hasVisibleElements ? 'show' : ''}
    >
      {/* Heart Rate Monitor - Auto-show when data available */}
      <HeartRateMonitor pulsoidToken={API_KEYS.PULSOID} />

      {/* Stream Info and Movement Container */}
      <div className="stream-container" style={{ position: 'absolute', top: '10px', right: '10px' }}>
        {/* Stream Info - Live Status Display */}
        <div className="stream-info">
          {settings.showTime && (
            <div className={`stream-time ${!validTimezone ? 'hidden' : ''}`}>
              <span>{time}</span>
              {location && location.countryCode && settings.showLocation && (
                <Image
                  src={`https://flagcdn.com/${location.countryCode}.svg`}
                  alt={`Country: ${location.label}`}
                  width={32}
                  height={20}
                  unoptimized
                />
              )}
            </div>
          )}
          {settings.showLocation && (
            <div className={`stream-location ${!validLocation ? 'hidden' : ''}`}>
              {location && location.label}
            </div>
          )}
          {settings.showWeather && (
            <div className={`stream-weather ${!validWeather ? 'hidden' : ''}`}>
              {weather && (
                <>
                  <div className="weather-temp" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexDirection: settings.weatherIconPosition === 'left' ? 'row-reverse' : 'row'
                  }}>
                    <span>{weather.temp}°C / {Math.round(weather.temp * 9 / 5 + 32)}°F</span>
                    {settings.showWeatherIcon && (
                      <div className="weather-icon-container">
                        <Image
                          src={`https://openweathermap.org/img/wn/${weather.icon}@4x.png`}
                          alt={`Weather: ${capitalizeWords(weather.desc)}`}
                          width={30}
                          height={30}
                          unoptimized
                        />
                      </div>
                    )}
                  </div>
                  {settings.showWeatherCondition && (
                    <div className="weather-desc">
                      {capitalizeWords(weather.desc)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Stream Movement - GPS Minimap */}
        {shouldShowMinimap() && mapCoords && (
          <div className="stream-movement">
            <LeafletMinimap 
              lat={mapCoords[0]} 
              lon={mapCoords[1]} 
              isVisible={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}