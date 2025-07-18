"use client";

// Note: Third-party cookie warnings from external services (Pulsoid, LocationIQ, etc.) 
// are expected in development and can be safely ignored. These services use cookies 
// for session management and analytics.

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
  capitalizeWords,
  celsiusToFahrenheit,
} from '@/utils/overlay-utils';
import HeartRateMonitor from '@/components/HeartRateMonitor';
import dynamic from 'next/dynamic';
const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});

// === 🎯 CONFIGURATION CONSTANTS ===
const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes - as requested
  LOCATION_UPDATE: 60000, // 1 minute - as requested
  OVERLAY_FADE_TIMEOUT: 5000, // 5 seconds to force fade-in
  MINIMAP_HIDE_DELAY: 120000, // 2 minutes - hide minimap if no GPS data
  SPEED_HIDE_DELAY: 10000, // 10 seconds - hide speed when below threshold
} as const;

const THRESHOLDS = {
  LOCATION_DISTANCE: 100, // 100 meters - as requested
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
  // Add overlay-page class to body for page-specific CSS
  useEffect(() => {
    if (hasLoggedInitialization.current) return;
    hasLoggedInitialization.current = true;
    
    Logger.overlay('Initializing streaming overlay');
    document.body.classList.add('overlay-page');
    Logger.overlay('Added overlay-page CSS class to body');
    
    // Log connection sequence
    Logger.overlay('Connection sequence: Settings SSE → HeartRate → RTIRL (with delays)');
    
    return () => {
      document.body.classList.remove('overlay-page');
    };
  }, []);

  // === �� OVERLAY STATE ===
  const [time, setTime] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  
  // Loading states
  const [isLoading, setIsLoading] = useState({
    weather: true,
    location: true,
    timezone: true
  });

  // Image loading states
  const [imagesLoaded, setImagesLoaded] = useState({
    weatherIcon: false,
    countryFlag: false
  });

  // Heart rate fade states
  const [heartRateVisible, setHeartRateVisible] = useState(false);
  const [heartRateFadeIn, setHeartRateFadeIn] = useState(false);
  const heartRateRef = useRef<HTMLDivElement>(null);

  // Settings state
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  
  // Update refs when state changes
  useEffect(() => {
    currentSettings.current = settings;
  }, [settings]);
  
  useEffect(() => {
    currentIsLoading.current = isLoading;
  }, [isLoading]);
  
  useEffect(() => {
    currentTimezone.current = timezone;
  }, [timezone]);

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
  
  // Speed-based minimap refs
  const speedBasedVisible = useRef(false);
  const speedAboveThresholdCount = useRef(0);
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // Time formatter
  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  
  // Refs for current state values (to avoid useEffect dependencies)
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  
  // Connection management refs
  const isUpdatingWeather = useRef(false);
  
  // Rate limiting refs
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);
  const weatherAPICooldown = 300000; // 5 minutes between weather API calls
  const locationAPICooldown = 300000; // 5 minutes between location API calls
  
  // Logging flags to prevent duplicate logs
  const hasLoggedInitialization = useRef(false);

  // === 🗺️ MINIMAP VISIBILITY LOGIC ===
  const shouldShowMinimap = useCallback(() => {
    if (!mapCoords) return false;
    const manualShow = settings.showMinimap;
    const speedBasedShow = settings.minimapSpeedBased && speedBasedVisible.current;
    return manualShow || speedBasedShow;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased]);

  // === 🎯 SIMPLIFIED OVERLAY READY LOGIC ===
  const isOverlayReady = useCallback(() => {
    // Check if we have any visible elements configured
    const hasConfiguredElements = settings.showTime || settings.showLocation || settings.showWeather || shouldShowMinimap();
    if (!hasConfiguredElements) return false;

    // Check if all required data is loaded
    const dataReady = !isLoading.weather && !isLoading.location && !isLoading.timezone;
    if (!dataReady) return false;

    // For images, only wait if we actually have the data to show them
    // Once an image is loaded, consider it ready for the session
    const weatherIconReady = !settings.showWeatherIcon || !weather?.icon || imagesLoaded.weatherIcon;
    const countryFlagReady = !settings.showLocation || !location?.countryCode || imagesLoaded.countryFlag;
    
    return weatherIconReady && countryFlagReady;
  }, [settings, isLoading.weather, isLoading.location, isLoading.timezone, imagesLoaded.weatherIcon, imagesLoaded.countryFlag, weather, location, shouldShowMinimap]);

  // === 👁️ OVERLAY VISIBILITY LOGIC ===
  const [overlayVisible, setOverlayVisible] = useState(false);
  
  useEffect(() => {
    const overlayReady = isOverlayReady();
    if (overlayReady && !overlayVisible) {
      // Add 1 second delay to ensure images are fully loaded
      const delay = setTimeout(() => {
        setOverlayVisible(true);
      }, 1000);
      
      return () => clearTimeout(delay);
    } else if (!overlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [overlayVisible, isOverlayReady]);
  
  const shouldShowOverlay = overlayVisible;

  // === ⏰ TIME MANAGEMENT ===
  useEffect(() => {
    if (!timezone || !formatter.current) return;
    
    function updateTime() {
      const now = new Date();
      const timeParts = formatter.current!.formatToParts(now);
      
      const timePart = timeParts.find(part => part.type === 'hour' || part.type === 'minute')?.value || '';
      const minutePart = timeParts.find(part => part.type === 'minute')?.value || '';
      const ampmPart = timeParts.find(part => part.type === 'dayPeriod')?.value || '';
      
      setTime(`${timePart}:${minutePart} ${ampmPart}`);
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
      const now = Date.now();
      if (lastWeatherCoords.current && !isUpdatingWeather.current && 
          (now - lastWeatherAPICall.current) >= weatherAPICooldown) {
        isUpdatingWeather.current = true;
        lastWeatherAPICall.current = now;
        const [lat, lon] = lastWeatherCoords.current;
        Logger.weather('Performing scheduled weather/timezone update', { lat, lon });
        
        try {
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result) {
          // Update weather if available
          if (result.weather) {
            setWeather(result.weather);
            setIsLoading(prev => ({ ...prev, weather: false }));
            lastWeatherUpdate.current = Date.now();
            Logger.weather('Weather data updated successfully', result.weather);
          } else {
            // Weather API succeeded but no weather data - mark as loaded
            setIsLoading(prev => ({ ...prev, weather: false }));
            Logger.weather('Weather API succeeded but no weather data available');
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
              setIsLoading(prev => ({ ...prev, timezone: false }));
              lastTimezoneUpdate.current = Date.now();
              Logger.overlay('Timezone updated successfully', { timezone: result.timezone });
            } catch (error) {
              Logger.error('Failed to set timezone', error);
              setIsLoading(prev => ({ ...prev, timezone: false }));
            }
          }
        } else {
          // Weather API failed - mark as loaded so it doesn't block the overlay
          setIsLoading(prev => ({ ...prev, weather: false }));
          Logger.error('Weather API failed - marking as loaded to prevent overlay blocking');
        }
              } catch (error) {
          Logger.error('Weather update failed', error);
          setIsLoading(prev => ({ ...prev, weather: false }));
        } finally {
          isUpdatingWeather.current = false;
        }
      } else if (lastWeatherCoords.current) {
        // Rate limited - skip this update
        Logger.weather('Weather update skipped due to rate limiting', { 
          timeSinceLastCall: now - lastWeatherAPICall.current,
          cooldown: weatherAPICooldown 
        });
      }
    }
    
    if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    weatherRefreshTimer.current = setInterval(doWeatherUpdate, TIMERS.WEATHER_TIMEZONE_UPDATE);
    
    return () => {
      if (weatherRefreshTimer.current) clearInterval(weatherRefreshTimer.current);
    };
  }, [timezone]);

  // === 📍 LOCATION UPDATE LOGIC ===
  const updateFromCoordinates = useCallback(async (lat: number, lon: number) => {
    if (!isValidCoordinate(lat, lon)) {
      Logger.error('Invalid coordinates received', { lat, lon });
      return;
    }
    
    // Store coordinates for timer-based weather/timezone updates
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    // If first time getting coordinates, do immediate weather update (respect rate limits)
    const currentTime = Date.now();
    if (!hadCoords && currentIsLoading.current.weather && 
        (currentTime - lastWeatherAPICall.current) >= weatherAPICooldown) {
      lastWeatherAPICall.current = currentTime;
      Logger.weather('First coordinates received - fetching immediate weather update');
      try {
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result?.weather) {
          setWeather(result.weather);
          setIsLoading(prev => ({ ...prev, weather: false }));
          lastWeatherUpdate.current = Date.now();
          Logger.weather('Initial weather data loaded', result.weather);
        } else {
          // Weather API succeeded but no weather data - mark as loaded
          setIsLoading(prev => ({ ...prev, weather: false }));
          Logger.weather('Initial weather API succeeded but no weather data available');
        }
        
        if (result?.timezone && result.timezone !== currentTimezone.current) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: result.timezone,
            });
            setTimezone(result.timezone);
            setIsLoading(prev => ({ ...prev, timezone: false }));
            lastTimezoneUpdate.current = Date.now();
            Logger.overlay('Initial timezone set', { timezone: result.timezone });
          } catch (error) {
            Logger.error('Failed to set initial timezone', error);
            setIsLoading(prev => ({ ...prev, timezone: false }));
          }
        }
      } catch (error) {
        Logger.error('Immediate weather update failed', error);
        // Mark weather as loaded so it doesn't block the overlay
        setIsLoading(prev => ({ ...prev, weather: false }));
      }
    } else if (!hadCoords && currentIsLoading.current.weather) {
      // Rate limited - skip initial weather update
      Logger.weather('Initial weather update skipped due to rate limiting', { 
        timeSinceLastCall: currentTime - lastWeatherAPICall.current,
        cooldown: weatherAPICooldown 
      });
      // Mark weather as loaded so it doesn't block the overlay
      setIsLoading(prev => ({ ...prev, weather: false }));
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
    
    // Update location name from LocationIQ (with rate limiting)
    if (API_KEYS.LOCATIONIQ && (now - lastLocationAPICall.current) >= locationAPICooldown) {
      lastLocationAPICall.current = now;
      try {
        const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
        if (loc) {
          const label = formatLocation(loc);
          setLocation({ label, countryCode: loc.countryCode || '' });
          setIsLoading(prev => ({ ...prev, location: false }));
          lastLocationUpdate.current = now;
          Logger.location('Location name updated', { label, countryCode: loc.countryCode });
          
          // Use timezone from LocationIQ as fallback
          if (loc.timezone && loc.timezone !== currentTimezone.current) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: loc.timezone,
              });
              setTimezone(loc.timezone);
              setIsLoading(prev => ({ ...prev, timezone: false }));
              lastTimezoneUpdate.current = now;
              Logger.overlay('Timezone updated from LocationIQ', { timezone: loc.timezone });
            } catch (error) {
              Logger.error('Failed to set timezone from LocationIQ', error);
              setIsLoading(prev => ({ ...prev, timezone: false }));
            }
          }
        } else {
          // Location API succeeded but no location data - mark as loaded
          setIsLoading(prev => ({ ...prev, location: false }));
          Logger.location('Location API succeeded but no location data available');
        }
      } catch (error) {
        Logger.error('Location API failed', error);
        // Mark location as loaded so it doesn't block the overlay
        setIsLoading(prev => ({ ...prev, location: false }));
      }
    } else if (API_KEYS.LOCATIONIQ) {
      // Rate limited - skip this update
      Logger.location('Location update skipped due to rate limiting', { 
        timeSinceLastCall: now - lastLocationAPICall.current,
        cooldown: locationAPICooldown 
      });
      // Mark location as loaded if we haven't already
      if (currentIsLoading.current.location) {
        setIsLoading(prev => ({ ...prev, location: false }));
      }
    } else {
      // No LocationIQ API key - mark location as loaded
      setIsLoading(prev => ({ ...prev, location: false }));
      Logger.warn('No LocationIQ API key - marking location as loaded');
    }
  }, []); // Remove dependencies to prevent frequent recreation

  // === 📡 RTIRL INTEGRATION ===
  useEffect(() => {
    Logger.overlay('Initializing RealtimeIRL integration');
    
    // Add a small delay to let other connections establish first
    const initTimeout = setTimeout(() => {
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
              setIsLoading(prev => ({ ...prev, weather: false }));
              lastWeatherUpdate.current = Date.now();
              Logger.weather('Weather data received from RTIRL', weatherData);
            } else if (currentIsLoading.current.weather) {
              // RTIRL has no weather data but we're still loading - mark as loaded
              setIsLoading(prev => ({ ...prev, weather: false }));
              Logger.weather('RTIRL has no weather data - marking as loaded');
            }
            
            // Location data
            if (payload.location) {
              const label = formatLocation(payload.location);
              const countryCode = payload.location.countryCode ? payload.location.countryCode.toLowerCase() : '';
              if (label && countryCode) {
                setLocation({ label, countryCode });
                setIsLoading(prev => ({ ...prev, location: false }));
                lastLocationUpdate.current = Date.now();
                Logger.location('Location data received from RTIRL', { label, countryCode });
              } else if (currentIsLoading.current.location) {
                // RTIRL has location but no valid label/country - mark as loaded
                setIsLoading(prev => ({ ...prev, location: false }));
                Logger.location('RTIRL has location but no valid label/country - marking as loaded');
              }
            } else if (currentIsLoading.current.location) {
              // RTIRL has no location data but we're still loading - mark as loaded
              setIsLoading(prev => ({ ...prev, location: false }));
              Logger.location('RTIRL has no location data - marking as loaded');
            }
            
            // Timezone data
            if (payload.location?.timezone && payload.location.timezone !== currentTimezone.current) {
              try {
                formatter.current = new Intl.DateTimeFormat('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  timeZone: payload.location.timezone,
                });
                setTimezone(payload.location.timezone);
                setIsLoading(prev => ({ ...prev, timezone: false }));
                lastTimezoneUpdate.current = Date.now();
                Logger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
              } catch (error) {
                Logger.error('Failed to set timezone from RTIRL', error);
                setIsLoading(prev => ({ ...prev, timezone: false }));
              }
            }
            
            // GPS coordinates
            let lat: number | null = null;
            let lon: number | null = null;
            if (payload.location) {
              // Handle both lat/lon and latitude/longitude formats
              if ('lat' in payload.location && 'lon' in payload.location) {
                lat = payload.location.lat;
                lon = payload.location.lon;
              } else if ('latitude' in payload.location && 'longitude' in payload.location) {
                const loc = payload.location as { latitude: number; longitude: number };
                lat = loc.latitude;
                lon = loc.longitude;
              }
            }
            
            if (lat !== null && lon !== null && isValidCoordinate(lat, lon)) {
              Logger.overlay('GPS coordinates received', { lat, lon });
              updateFromCoordinates(lat, lon);
              
              // Update minimap coordinates
              setMapCoords([lat, lon]);
              
              // Clear existing timeout and set new one (only if not manually enabled)
              if (minimapTimeout.current) {
                clearTimeout(minimapTimeout.current);
              }
              if (!currentSettings.current.showMinimap) {
                // Only auto-hide if manual display is not enabled
                minimapTimeout.current = setTimeout(() => {
                  Logger.overlay('GPS data timeout - hiding minimap (auto-hide only)');
                  setMapCoords(null);
                }, TIMERS.MINIMAP_HIDE_DELAY);
              }
            }
          });
        } else {
          Logger.warn('RealtimeIRL API not available or missing API key');
        }
      };
    }, 1000); // 1 second delay to let other connections establish first
    
    return () => {
      clearTimeout(initTimeout);
      // Note: We can't easily remove the script tag as it may have already loaded
      // The RTIRL library handles its own cleanup
    };
  }, [updateFromCoordinates]); // Include updateFromCoordinates dependency



  // === 🎛️ SETTINGS MANAGEMENT ===
  // (Settings SSE logic remains the same but with better logging)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    let isPolling = false;
    let pollingInterval: NodeJS.Timeout | null = null;
    let lastKnownModified = Date.now(); // Track when we last received settings
    
    function startSmartPolling() {
      if (isPolling) return;
      isPolling = true;
      Logger.settings('Starting smart polling fallback for settings');
      
      pollingInterval = setInterval(async () => {
        try {
          const response = await authenticatedFetch(`/api/check-settings-update?lastModified=${lastKnownModified}`);
          const data = await response.json();
          
          if (data.hasChanges) {
            Logger.settings('Settings change detected via smart polling', data.settings);
            setSettings(data.settings);
            lastKnownModified = data.lastModified;
            
            // Try to reconnect SSE after successful update
            if (reconnectAttempts > 0) {
              Logger.settings('Attempting to restore SSE connection after successful polling update');
              stopPolling();
              reconnectAttempts = 0;
              connectSSE();
            }
          } else {
            // No changes - just update timestamp
            lastKnownModified = data.lastModified;
            Logger.settings('No settings changes detected (smart polling)');
          }
        } catch (err) {
          Logger.error('Smart polling failed', err);
        }
      }, 300000); // Check every 5 minutes instead of 60 seconds
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
          // Update last known modified timestamp
          if (data._lastModified) {
            lastKnownModified = data._lastModified;
          }
        })
        .catch(err => Logger.error('Failed to load initial settings', err));
      
      if (eventSource) {
        eventSource.close();
      }
      
      eventSource = createAuthenticatedEventSource('/api/settings-stream');
      
      eventSource.onopen = () => {
        Logger.settings('✅ SSE connection established successfully');
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
            Logger.settings(`⚡ Real-time settings update received (${latency}ms latency)`, data);
            
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { timestamp, type, ...settingsOnly } = data;
            setSettings(settingsOnly);
            return;
          }
          
          // Handle initial settings with timestamp
          if (data._type === 'initial') {
            Logger.settings('📡 Initial settings received via SSE', data);
            const { _lastModified, ...settingsOnly } = data;
            setSettings(settingsOnly);
            if (_lastModified) {
              lastKnownModified = _lastModified;
            }
            return;
          }
          
          // Legacy format
          Logger.settings('📡 Settings update received (legacy format)', data);
          setSettings(data);
        } catch (error) {
          Logger.error('Failed to parse settings update', error);
        }
      };
      
      eventSource.onerror = (error) => {
        Logger.error(`❌ SSE connection error (ReadyState: ${eventSource?.readyState})`, error);
        
        if (eventSource?.readyState === EventSource.CLOSED || 
            eventSource?.readyState === EventSource.CONNECTING) {
          Logger.settings('🔄 SSE connection lost - attempting reconnection');
          
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), 30000);
          Logger.settings(`⏰ Reconnecting SSE in ${delay}ms (attempt ${reconnectAttempts})`);
          
          // Start polling only after 5 failed attempts (more aggressive SSE reconnection)
          if (reconnectAttempts >= 5 && !isPolling) {
            Logger.settings('⚠️ Multiple SSE failures - starting smart polling fallback');
            startSmartPolling();
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

  // === 🗺️ MANUAL MINIMAP SETTING LOGIC ===
  useEffect(() => {
    // Clear auto-hide timeout when manual display is enabled
    if (settings.showMinimap && minimapTimeout.current) {
      Logger.overlay('Manual minimap enabled - clearing auto-hide timeout');
      clearTimeout(minimapTimeout.current);
      minimapTimeout.current = null;
    }
    
    // Set auto-hide timeout when manual display is disabled and we have coordinates
    if (!settings.showMinimap && mapCoords && !minimapTimeout.current) {
      Logger.overlay('Manual minimap disabled - setting auto-hide timeout');
      minimapTimeout.current = setTimeout(() => {
        Logger.overlay('GPS data timeout - hiding minimap (manual disabled)');
        setMapCoords(null);
      }, TIMERS.MINIMAP_HIDE_DELAY);
    }
  }, [settings.showMinimap, mapCoords]);

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
    if (hasLoggedInitialization.current) return;
    Logger.overlay('Setting up initial overlay state');

    // Set timeout to force overlay to show after 6 seconds (5 + 1 extra) even if some services fail
    const overlayTimeout = setTimeout(() => {
      // Check if overlay is ready using current state values
      const hasConfiguredElements = currentSettings.current.showTime || 
                                   currentSettings.current.showLocation || 
                                   currentSettings.current.showWeather || 
                                   (currentSettings.current.showMinimap || 
                                    (currentSettings.current.minimapSpeedBased && speedBasedVisible.current));
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      const overlayReady = hasConfiguredElements && dataReady;
      
      if (!overlayReady) {
        Logger.overlay('Overlay timeout reached - forcing fade-in with available data');
        setIsLoading({
          weather: false,
          location: false,
          timezone: false
        });
      } else {
        Logger.overlay('Overlay already ready - skipping timeout force');
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000); // Add 1 second extra delay

    return () => clearTimeout(overlayTimeout);
  }, []); // Run only once on mount



  // Monitor heart rate visibility changes
  useEffect(() => {
    const checkHeartRateVisibility = () => {
      const heartRateElement = heartRateRef.current;
      if (heartRateElement) {
        const isVisible = heartRateElement.children.length > 0;
        if (isVisible && !heartRateVisible) {
          setHeartRateVisible(true);
          setHeartRateFadeIn(true);
        } else if (!isVisible && heartRateVisible) {
          setHeartRateFadeIn(false);
          // Delay setting visible to false to allow fade out animation
          setTimeout(() => setHeartRateVisible(false), 1500);
        }
      }
    };

    // Check immediately and then every 2 seconds (reduced frequency to reduce noise)
    checkHeartRateVisibility();
    const interval = setInterval(checkHeartRateVisibility, 2000);

    return () => clearInterval(interval);
  }, [heartRateVisible]);

  // === 🎨 RENDER OVERLAY ===
  return (
    <div 
      id="overlay" 
      className={shouldShowOverlay ? 'show' : ''}
    >
      {/* Heart Rate Monitor - Auto-show when data available */}
      <div 
        ref={heartRateRef}
        className={heartRateFadeIn ? 'fade-in-slow-no-move' : heartRateVisible ? '' : 'fade-out-slow'}
      >
        <HeartRateMonitor 
          pulsoidToken={API_KEYS.PULSOID} 
        />
      </div>

      {/* Stream Info and Movement Container */}
      <div className="stream-container" style={{ position: 'absolute', top: '10px', right: '10px' }}>
        {/* Stream Info - Live Status Display */}
        <div className="stream-info">
          {settings.showTime && timezone && (
            <div className="stream-time">
              <div className="time-display">
                <span className="time-main">{time.split(' ')[0]}</span>
                <span className="time-ampm">{time.split(' ')[1]}</span>
              </div>
              {location && location.countryCode && settings.showLocation && (
                <Image
                  src={`https://flagcdn.com/${location.countryCode}.svg`}
                  alt={`Country: ${location.label}`}
                  width={32}
                  height={20}
                  unoptimized
                  priority
                  loading="eager"
                  onLoad={() => setImagesLoaded(prev => ({ ...prev, countryFlag: true }))}
                  onError={() => setImagesLoaded(prev => ({ ...prev, countryFlag: true }))}
                />
              )}
            </div>
          )}
          {settings.showLocation && (
            <div className="stream-location">
              {location && location.label}
            </div>
          )}
          {settings.showWeather && (
            <div className="stream-weather">
              {weather && (
                <>
                  <div className={`weather-temp ${settings.weatherIconPosition === 'left' ? 'left-icon' : ''}`}>
                    <span>{celsiusToFahrenheit(weather.temp)}°F</span>
                    <span className="temp-separator"> / </span>
                    <span>{weather.temp}°C</span>
                    {settings.showWeatherIcon && (
                      <div className="weather-icon-container">
                        <Image
                          src={`https://openweathermap.org/img/wn/${weather.icon}@4x.png`}
                          alt={`Weather: ${capitalizeWords(weather.desc)}`}
                          width={30}
                          height={30}
                          unoptimized
                          priority
                          loading="eager"
                          onLoad={() => setImagesLoaded(prev => ({ ...prev, weatherIcon: true }))}
                          onError={() => setImagesLoaded(prev => ({ ...prev, weatherIcon: true }))}
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

        {/* Stream Movement - GPS Minimap with Speed */}
        {shouldShowMinimap() && mapCoords && (
          <div className="stream-movement">
            <MapboxMinimap 
              lat={mapCoords[0]} 
              lon={mapCoords[1]} 
              isVisible={true}
            />
            {/* Speed Display - shows when moving */}
            {speed > 0 && (
              <div className="stream-speed-display">
                <span className="speed-value">
                  {(speed * 3.6).toFixed(0)}
                </span>
                <span className="speed-unit">km/h</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}