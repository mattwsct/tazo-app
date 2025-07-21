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

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  shortenCountryName,
  LocationData,
} from '@/utils/overlay-utils';

// Helper function to get day/night weather icon
function getWeatherIcon(icon: string, timezone: string | null, sunrise: string | null, sunset: string | null): string {
  if (!timezone) return icon;
  
  try {
    // If icon already has day/night suffix, return as is
    if (icon.endsWith('d') || icon.endsWith('n')) {
      return icon;
    }
    
    const currentTime = new Date();
    const currentLocal = new Date(currentTime.toLocaleString('en-US', { timeZone: timezone }));
    let isDay: boolean;
    
    // If we have sunrise/sunset data, use actual times
    if (sunrise && sunset) {
      const sunriseTime = new Date(sunrise);
      const sunsetTime = new Date(sunset);
      isDay = currentLocal >= sunriseTime && currentLocal < sunsetTime;
    } else {
      // Fallback to fixed times if no sunrise/sunset data
      const hour = currentLocal.getHours();
      isDay = hour >= 6 && hour < 18;
    }
    
    // Add day/night suffix
    const suffix = isDay ? 'd' : 'n';
    return icon.replace(/@\d+x$/, '') + suffix;
  } catch {
    return icon;
  }
}
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
  API_COOLDOWN: 300000, // 5 minutes between API calls
  POLLING_INTERVAL: 300000, // 5 minutes for settings polling
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
    
    document.body.classList.add('overlay-page');
    
    return () => {
      document.body.classList.remove('overlay-page');
    };
  }, []);

  // === �� OVERLAY STATE ===
  const [time, setTime] = useState('Loading...');
  const [date, setDate] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string; originalData?: LocationData } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sunrise, setSunrise] = useState<string | null>(null);
  const [sunset, setSunset] = useState<string | null>(null);
  
  // Loading states
  const [isLoading, setIsLoading] = useState({
    weather: true,
    location: true,
    timezone: true
  });





  // Heart rate visibility state

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
  
  // Time and date formatters
  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  
  // Refs for current state values (to avoid useEffect dependencies)
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  
  // Connection management refs
  const isUpdatingWeather = useRef(false);
  
  // Rate limiting refs
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);
  
  // Logging flags to prevent duplicate logs
  const hasLoggedInitialization = useRef(false);

  // === 🗺️ MINIMAP VISIBILITY LOGIC ===
  const shouldShowMinimap = useCallback(() => {
    if (!mapCoords) return false;
    const manualShow = settings.showMinimap;
    const speedBasedShow = settings.minimapSpeedBased && speedBasedVisible.current;
    return manualShow || speedBasedShow;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased]);

  // === 👁️ SIMPLIFIED OVERLAY VISIBILITY ===
  const isLocationEnabled = settings.locationDisplay && settings.locationDisplay !== 'hidden';
  const [overlayVisible, setOverlayVisible] = useState(false);
  
  const isOverlayReady = useMemo(() => {
    // Always need timezone for time/date display
    if (isLoading.timezone) return false;
    
    // Check weather data if enabled
    if (settings.showWeather && isLoading.weather) return false;
    
    // Check location data if enabled
    if (isLocationEnabled && isLoading.location) return false;
    
    return true;
  }, [isLoading.timezone, isLoading.weather, isLoading.location, settings.showWeather, isLocationEnabled]);
  
  // Add 1 second delay for images to load
  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      const delay = setTimeout(() => {
        setOverlayVisible(true);
      }, 1000);
      
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);
  
  const shouldShowOverlay = overlayVisible;

  // === ⏰ TIME MANAGEMENT ===
  useEffect(() => {
    if (!timezone || !formatter.current || !dateFormatter.current) return;
    
    function updateTimeAndDate() {
      const now = new Date();
      
      // Update time
      const timeParts = formatter.current!.formatToParts(now);
      const timePart = timeParts.find(part => part.type === 'hour' || part.type === 'minute')?.value || '';
      const minutePart = timeParts.find(part => part.type === 'minute')?.value || '';
      const ampmPart = timeParts.find(part => part.type === 'dayPeriod')?.value || '';
      
      setTime(`${timePart}:${minutePart} ${ampmPart}`);
      
      // Update date
      const formattedDate = dateFormatter.current!.format(now);
      setDate(formattedDate);
    }
    
    // Update immediately
    updateTimeAndDate();
    
    function setupNextSync() {
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      
      // Set timeout to sync with the next minute boundary
      const syncTimeout = setTimeout(() => {
        updateTimeAndDate();
        
        // Set regular interval for the next hour, then re-sync
        let updateCount = 0;
        const interval = setInterval(() => {
          updateTimeAndDate();
          updateCount++;
          
          // Re-sync every hour (60 updates) to prevent drift
          if (updateCount >= 60) {
            clearInterval(interval);
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
          (now - lastWeatherAPICall.current) >= TIMERS.API_COOLDOWN) {
        isUpdatingWeather.current = true;
        lastWeatherAPICall.current = now;
        const [lat, lon] = lastWeatherCoords.current;
        
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
          
          // Update sunrise/sunset data if available
          if (result.sunrise && result.sunset) {
            setSunrise(result.sunrise);
            setSunset(result.sunset);
            Logger.weather('Sunrise/sunset data updated', { sunrise: result.sunrise, sunset: result.sunset });
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
              dateFormatter.current = new Intl.DateTimeFormat('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
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
          cooldown: TIMERS.API_COOLDOWN 
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
        (currentTime - lastWeatherAPICall.current) >= TIMERS.API_COOLDOWN) {
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
        
        // Update sunrise/sunset data if available
        if (result?.sunrise && result?.sunset) {
          setSunrise(result.sunrise);
          setSunset(result.sunset);
          Logger.weather('Initial sunrise/sunset data loaded', { sunrise: result.sunrise, sunset: result.sunset });
        }
        
        if (result?.timezone && result.timezone !== currentTimezone.current) {
          try {
            formatter.current = new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: result.timezone,
       });
            dateFormatter.current = new Intl.DateTimeFormat('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
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
          cooldown: TIMERS.API_COOLDOWN 
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
        // Significant movement detected
      }
    } else {
      // First update
      shouldUpdateLocation = true;
    }
    
    if (!shouldUpdateLocation) {
      return;
    }
    
    lastAPICoords.current = [lat, lon];
    
    // Update location name from LocationIQ (with rate limiting)
    if (API_KEYS.LOCATIONIQ && (now - lastLocationAPICall.current) >= TIMERS.API_COOLDOWN) {
      lastLocationAPICall.current = now;
      try {
        const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
        if (loc) {
          const label = formatLocation(loc, settings.locationDisplay);
          setLocation({ label, countryCode: loc.countryCode || '', originalData: loc });
          setIsLoading(prev => ({ ...prev, location: false }));
          lastLocationUpdate.current = now;
          
          // Only log location details if not in hidden mode
          if (settings.locationDisplay !== 'hidden') {
            Logger.location('Location name updated', { label, countryCode: loc.countryCode });
          }
          
          // Use timezone from LocationIQ as fallback
          if (loc.timezone && loc.timezone !== currentTimezone.current) {
            try {
              formatter.current = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: loc.timezone,
              });
              dateFormatter.current = new Intl.DateTimeFormat('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
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
          cooldown: TIMERS.API_COOLDOWN 
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
  }, [settings.locationDisplay]); // Include locationDisplay dependency to get current setting

  // === 📡 RTIRL INTEGRATION ===
  useEffect(() => {
    
    // Add a small delay to let other connections establish first
    const initTimeout = setTimeout(() => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
      script.async = true;
      document.body.appendChild(script);
      
      script.onload = () => {
        if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
          
          window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
            if (!p || typeof p !== 'object') return;
            const payload = p as RTIRLPayload;
            
            // Speed tracking for minimap
            if (typeof payload.speed === 'number') {
              setSpeed(payload.speed);
              // Speed update received
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
            } else if (currentIsLoading.current.weather) {
              // RTIRL has no weather data but we're still loading - mark as loaded
              setIsLoading(prev => ({ ...prev, weather: false }));
            }
            
            // Location data from RTIRL (basic coordinates only - detailed location comes from LocationIQ)
            if (payload.location) {
              // Only use RTIRL location data if we don't have detailed LocationIQ data
              // RTIRL provides coordinates but not city/state names
              const countryCode = payload.location.countryCode ? payload.location.countryCode.toLowerCase() : '';
              if (countryCode && !location?.label) {
                // Fallback: just show country if no detailed location data
                setLocation({ label: shortenCountryName('', countryCode), countryCode });
                setIsLoading(prev => ({ ...prev, location: false }));
                lastLocationUpdate.current = Date.now();
                
                // Basic location data received from RTIRL (country only)
              } else if (currentIsLoading.current.location) {
                // RTIRL has location but no valid country - mark as loaded
                setIsLoading(prev => ({ ...prev, location: false }));
                
                // RTIRL has location but no valid country
              }
            } else if (currentIsLoading.current.location) {
              // RTIRL has no location data but we're still loading - mark as loaded
              setIsLoading(prev => ({ ...prev, location: false }));
              
              // RTIRL has no location data
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
                dateFormatter.current = new Intl.DateTimeFormat('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      
      pollingInterval = setInterval(async () => {
        try {
          const response = await authenticatedFetch(`/api/check-settings-update?lastModified=${lastKnownModified}`);
          const data = await response.json();
          
          if (data.hasChanges) {
            setSettings(data.settings);
            lastKnownModified = data.lastModified;
            
            // Try to reconnect SSE after successful update
            if (reconnectAttempts > 0) {
              stopPolling();
              reconnectAttempts = 0;
              connectSSE();
            }
          } else {
            // No changes - just update timestamp
            lastKnownModified = data.lastModified;
          }
        } catch (err) {
          Logger.error('Smart polling failed', err);
        }
      }, TIMERS.POLLING_INTERVAL); // Check every 5 minutes instead of 60 seconds
    }
    
    function stopPolling() {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      isPolling = false;
    }
    
    function connectSSE() {
      
      // Load settings immediately as fallback
      authenticatedFetch('/api/get-settings')
        .then(res => res.json())
        .then(data => {
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
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { timestamp, type, ...settingsOnly } = data;
            setSettings(settingsOnly);
            return;
          }
          
          // Handle initial settings with timestamp
          if (data._type === 'initial') {
            const { _lastModified, ...settingsOnly } = data;
            setSettings(settingsOnly);
            if (_lastModified) {
              lastKnownModified = _lastModified;
            }
            return;
          }
          
          // Legacy format
          setSettings(data);
        } catch (error) {
          Logger.error('Failed to parse settings update', error);
        }
      };
      
      eventSource.onerror = (error) => {
        Logger.error(`❌ SSE connection error (ReadyState: ${eventSource?.readyState})`, error);
        
        if (eventSource?.readyState === EventSource.CLOSED || 
            eventSource?.readyState === EventSource.CONNECTING) {
                  reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), 30000);
        
        // Start polling only after 5 failed attempts (more aggressive SSE reconnection)
        if (reconnectAttempts >= 5 && !isPolling) {
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
      clearTimeout(minimapTimeout.current);
      minimapTimeout.current = null;
    }
    
    // Set auto-hide timeout when manual display is disabled and we have coordinates
    if (!settings.showMinimap && mapCoords && !minimapTimeout.current) {
      minimapTimeout.current = setTimeout(() => {
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
          speedBasedVisible.current = false;
          speedHideTimeout.current = null;
        }, TIMERS.SPEED_HIDE_DELAY);
      }
    }
  }, [speed, settings.minimapSpeedBased]);

  // === 🌅 INITIAL STATE SETUP ===
  useEffect(() => {
    if (hasLoggedInitialization.current) return;

    // Set timeout to force overlay to show after 6 seconds (5 + 1 extra) even if some services fail
    const overlayTimeout = setTimeout(() => {
      // Check if overlay is ready using current state values
      const hasConfiguredElements = currentSettings.current.locationDisplay || 
                                   currentSettings.current.showWeather || 
                                   (currentSettings.current.showMinimap || 
                                    (currentSettings.current.minimapSpeedBased && speedBasedVisible.current));
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      const overlayReady = hasConfiguredElements && dataReady;
      
      if (!overlayReady) {
        setIsLoading({
          weather: false,
          location: false,
          timezone: false
        });
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000); // Add 1 second extra delay

    return () => clearTimeout(overlayTimeout);
  }, []); // Run only once on mount

  // Heart rate visibility callback (kept for component interface compatibility)
  const handleHeartRateVisibilityChange = useCallback(() => {
    // Heart rate visibility is now always true since time/date are always shown
  }, []);

  // Reformat location when display mode changes
  useEffect(() => {
    if (location && location.originalData && settings.locationDisplay !== 'hidden') {
      const newLabel = formatLocation(location.originalData, settings.locationDisplay);
      if (newLabel && newLabel !== location.label) {
        setLocation({ 
          label: newLabel, 
          countryCode: location.countryCode || '', 
          originalData: location.originalData 
        });
      }
    }
  }, [settings.locationDisplay, location]); // Include location object

  // === 🎨 RENDER OVERLAY ===
  
  return (
    <div 
      id="overlay" 
      className={shouldShowOverlay ? 'show' : ''}
    >

      {/* Left Side - Time, Date, Heart Rate */}
      <div className="top-left">
        <div className="overlay-container">
          {/* Time Display */}
          {timezone && (
            <div className="time time-left">
              <div className="time-display">
                <span className="time-main">{time.split(' ')[0]}</span>
                <span className="time-ampm">{time.split(' ')[1]}</span>
              </div>
            </div>
          )}
          
          {/* Date Display */}
          {timezone && (
            <div className="date date-left">
              {date}
            </div>
          )}
            
            {/* Heart Rate */}
            <div ref={heartRateRef}>
              <HeartRateMonitor 
                pulsoidToken={API_KEYS.PULSOID} 
                onVisibilityChange={handleHeartRateVisibilityChange}
              />
            </div>
          </div>
        </div>

      {/* Right Side - Location, Weather */}
      {(isLocationEnabled || settings.showWeather || shouldShowMinimap()) && (
        <div className="top-right">
          {/* Stream Info - Live Status Display */}
          <div className="overlay-container">
            
            {settings.locationDisplay && (
              <div className="location" style={{ display: settings.locationDisplay === 'hidden' ? 'none' : 'flex' }}>
                {location && location.label ? location.label : ''}
                {location && location.countryCode && settings.locationDisplay !== 'hidden' && (
                  <Image
                    src={`https://flagcdn.com/${location.countryCode}.svg`}
                    alt={`Country: ${location.label}`}
                    width={32}
                    height={20}
                    unoptimized
                    priority
                    loading="eager"
                    className="location-flag"
                  />
                )}
              </div>
            )}
            
            {settings.showWeather && (
              <div className="weather">
                {weather && (
                  <div className="weather-container">
                    <div className="weather-content">
                      <div className="weather-description">
                        {weather.desc.toUpperCase()}
                      </div>
                      <div className="weather-temperature">
                        {weather.temp}°C / {celsiusToFahrenheit(weather.temp)}°F
                      </div>
                    </div>
                    <Image
                      src={`https://openweathermap.org/img/wn/${getWeatherIcon(weather.icon, timezone, sunrise, sunset)}@4x.png`}
                      alt={`Weather: ${capitalizeWords(weather.desc)}`}
                      width={24}
                      height={24}
                      unoptimized
                      priority
                      loading="eager"
                      className="weather-icon"
                    />
                  </div>
                )}
              </div>
            )}
            

          </div>

          {/* Stream Movement - GPS Minimap */}
          {shouldShowMinimap() && mapCoords && (
            <div className="minimap">
              <MapboxMinimap 
                lat={mapCoords[0]} 
                lon={mapCoords[1]} 
                isVisible={true}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}