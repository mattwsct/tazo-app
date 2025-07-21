"use client";

// Note: Third-party cookie warnings from external services (Pulsoid, LocationIQ, etc.) 
// are expected in development and can be safely ignored. These services use cookies 
// for session management and analytics.

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
import dynamic from 'next/dynamic';

import { authenticatedFetch, createAuthenticatedEventSource } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import HeartRateMonitor from '@/components/HeartRateMonitor';
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
import { OverlayLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';


const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});

// Helper function to get day/night weather icon
function getWeatherIcon(icon: string, timezone: string | null, sunrise: string | null, sunset: string | null): string {
  // Always strip any existing day/night suffix
  const baseIcon = icon.replace(/([dn])$/, '').replace(/@\dx$/, '');

  if (!timezone) return baseIcon + 'd'; // Default to day if timezone is missing

  try {
    // Parse current time in the target timezone
    const now = new Date();
    // Get the current time in the target timezone as a Date object
    const currentLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    let isDay = true;

    if (sunrise && sunset) {
      // Parse sunrise/sunset as Date objects (should be ISO strings)
      const sunriseTime = new Date(sunrise);
      const sunsetTime = new Date(sunset);

      // Convert sunrise/sunset to the same timezone as currentLocal for comparison
      // (Assume sunrise/sunset are in the correct local time already)
      isDay = currentLocal >= sunriseTime && currentLocal < sunsetTime;
    } else {
      // Fallback: 6am-6pm is day
      const hour = currentLocal.getHours();
      isDay = hour >= 6 && hour < 18;
    }

    // Add day/night suffix
    const suffix = isDay ? 'd' : 'n';
    return baseIcon + suffix;
  } catch {
    // Fallback to day icon if any error
    return baseIcon + 'd';
  }
}

// === 🎯 CONFIGURATION CONSTANTS ===
const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000, // 5 minutes - as requested
  LOCATION_UPDATE: 300000, // 5 minutes - more conservative for API limits
  OVERLAY_FADE_TIMEOUT: 5000, // 5 seconds to force fade-in
  MINIMAP_HIDE_DELAY: 30000, // 30 seconds - hide minimap if no GPS data
  SPEED_HIDE_DELAY: 30000, // 30 seconds - hide speed when below threshold (was 20s)
  API_COOLDOWN: 300000, // 5 minutes between API calls
  POLLING_INTERVAL: 600000, // 10 minutes for settings polling (was 5)
} as const;

const THRESHOLDS = {
  LOCATION_DISTANCE: 100, // 100 meters - as requested
  SPEED_SHOW: 10, // 10 km/h - show speed-based minimap
  SPEED_READINGS_REQUIRED: 2, // 2 successive readings above threshold (was 3)
} as const;

// === 🔑 API CONFIGURATION ===
const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

// === 🔍 API KEY VALIDATION ===
const validateApiKeys = (): boolean => {
  const missingKeys: string[] = [];
  
  if (!API_KEYS.RTIRL) missingKeys.push('RTIRL_PULL_KEY');
  if (!API_KEYS.LOCATIONIQ) missingKeys.push('LOCATIONIQ_KEY');
  if (!API_KEYS.PULSOID) missingKeys.push('PULSOID_TOKEN');
  if (!API_KEYS.MAPBOX) missingKeys.push('MAPBOX_ACCESS_TOKEN');
  
  if (missingKeys.length > 0) {
    console.warn('⚠️ [WARNING] Missing API keys', missingKeys);
    return false;
  }
  
  return true;
};

// Validate API keys on initialization
if (!validateApiKeys()) {
  console.warn('⚠️ Some API keys are missing. Some features may not work properly.');
}

// === 🌍 DATA INTERFACES ===
interface RTIRLPayload {
  speed?: number;
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
}



// === 🎮 MAIN OVERLAY COMPONENT ===
export default function OverlayPage() {
  // Performance monitoring
  useRenderPerformance('OverlayPage');
  
  // Add overlay-page class to body for page-specific CSS
  useEffect(() => {
    if (hasLoggedInitialization.current) return;
    hasLoggedInitialization.current = true;
    
    document.body.classList.add('overlay-page');
    
    return () => {
      document.body.classList.remove('overlay-page');
    };
  }, []);

  // === 🚨 ERROR STATE MANAGEMENT ===
  const [errors, setErrors] = useState<{
    rtirl: string | null;
    weather: string | null;
    location: string | null;
    timezone: string | null;
  }>({
    rtirl: null,
    weather: null,
    location: null,
    timezone: null,
  });



  // === 🔄 ERROR RECOVERY UTILITY ===
  const clearError = useCallback((service: keyof typeof errors) => {
    setErrors(prev => ({ ...prev, [service]: null }));
  }, []);

  const setError = useCallback((service: keyof typeof errors, error: string) => {
    setErrors(prev => ({ ...prev, [service]: error }));
    OverlayLogger.error(`${service.toUpperCase()} service error`, error);
  }, []);

  // === 🎯 OVERLAY STATE ===
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



  // === 🌐 NETWORK STATUS MONITORING ===
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      OverlayLogger.overlay('Network connection restored');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      OverlayLogger.warn('Network connection lost');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Show network status in console for debugging
  useEffect(() => {
    if (!isOnline) {
      OverlayLogger.warn('Offline mode - some features may be limited');
    }
  }, [isOnline]);

  // === 🔄 AUTOMATIC ERROR RECOVERY ===
  // (Moved after doWeatherUpdate function definition)

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
  

  
  // Ensure settings are always valid
  useEffect(() => {
    if (!settings.locationDisplay || !settings.showWeather === undefined || !settings.showMinimap === undefined) {
      setSettings(DEFAULT_OVERLAY_SETTINGS);
    }
  }, [settings]);
  
  const isOverlayReady = useMemo(() => {
    // Always need timezone for time/date display
    if (isLoading.timezone) return false;
    
    // For now, show overlay as soon as timezone is ready
    // Weather and location will appear when they load
    return true;
  }, [isLoading.timezone]);
  
  // Add minimal delay for images to load
  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      const delay = setTimeout(() => {
        setOverlayVisible(true);
      }, 200);
      
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
            

            
            OverlayLogger.weather('Weather data updated successfully', result.weather);
          } else {
            // Weather API succeeded but no weather data - mark as loaded
            setIsLoading(prev => ({ ...prev, weather: false }));
            OverlayLogger.weather('Weather API succeeded but no weather data available');
          }
          
          // Update sunrise/sunset data if available
          if (result.sunrise && result.sunset) {
            setSunrise(result.sunrise);
            setSunset(result.sunset);
            OverlayLogger.weather('Sunrise/sunset data updated', { sunrise: result.sunrise, sunset: result.sunset });
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
              

              
              OverlayLogger.overlay('Timezone updated successfully', { timezone: result.timezone });
            } catch (error) {
              OverlayLogger.error('Failed to set timezone', error);
              setIsLoading(prev => ({ ...prev, timezone: false }));
            }
          }
        } else {
          // Weather API failed
          setError('weather', 'Weather API returned no data');
          OverlayLogger.warn('Weather API failed');
          setError('timezone', 'No timezone data available');
          OverlayLogger.error('No timezone data available');
          
          // Clear weather data and mark as loaded so it doesn't block the overlay
          setWeather(null);
          setIsLoading(prev => ({ ...prev, weather: false }));
          OverlayLogger.error('Weather API failed - clearing weather data and marking as loaded');
        }
              } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setError('weather', `Weather update failed: ${errorMessage}`);
          OverlayLogger.error('Weather update failed', error);
          setWeather(null);
          setIsLoading(prev => ({ ...prev, weather: false }));
        } finally {
          isUpdatingWeather.current = false;
        }
      } else if (lastWeatherCoords.current) {
        // Rate limited - skip this update
        OverlayLogger.weather('Weather update skipped due to rate limiting', { 
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
      OverlayLogger.error('Invalid coordinates received', { lat, lon });
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
      OverlayLogger.weather('First coordinates received - fetching immediate weather update');
      try {
        const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
        
        if (result?.weather) {
          setWeather(result.weather);
          setIsLoading(prev => ({ ...prev, weather: false }));
          lastWeatherUpdate.current = Date.now();
          OverlayLogger.weather('Initial weather data loaded', result.weather);
        } else {
          // Weather API succeeded but no weather data - mark as loaded
          setIsLoading(prev => ({ ...prev, weather: false }));
          OverlayLogger.weather('Initial weather API succeeded but no weather data available');
        }
        
        // Update sunrise/sunset data if available
        if (result?.sunrise && result?.sunset) {
          setSunrise(result.sunrise);
          setSunset(result.sunset);
          OverlayLogger.weather('Initial sunrise/sunset data loaded', { sunrise: result.sunrise, sunset: result.sunset });
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
            OverlayLogger.overlay('Initial timezone set', { timezone: result.timezone });
          } catch (error) {
            OverlayLogger.error('Failed to set initial timezone', error);
            setIsLoading(prev => ({ ...prev, timezone: false }));
          }
        }
      } catch (error) {
        OverlayLogger.error('Immediate weather update failed', error);
        // Clear weather data and mark as loaded so it doesn't block the overlay
        setWeather(null);
        setIsLoading(prev => ({ ...prev, weather: false }));
      }
    } else if (!hadCoords && currentIsLoading.current.weather) {
      // Rate limited - skip initial weather update
              OverlayLogger.weather('Initial weather update skipped due to rate limiting', { 
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
          clearError('location');
          const label = formatLocation(loc, settings.locationDisplay);
          setLocation({ label, countryCode: loc.countryCode || '', originalData: loc });
          setIsLoading(prev => ({ ...prev, location: false }));
          lastLocationUpdate.current = now;
          

          
          // Only log location details if not in hidden mode
          if (settings.locationDisplay !== 'hidden') {
            OverlayLogger.location('Location name updated', { label, countryCode: loc.countryCode });
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
              OverlayLogger.overlay('Timezone updated from LocationIQ', { timezone: loc.timezone });
            } catch (error) {
              OverlayLogger.error('Failed to set timezone from LocationIQ', error);
              setIsLoading(prev => ({ ...prev, timezone: false }));
            }
          }
        } else {
          // Location API succeeded but no location data - mark as loaded
          setIsLoading(prev => ({ ...prev, location: false }));
          OverlayLogger.location('Location API succeeded but no location data available');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setError('location', `Location API failed: ${errorMessage}`);
        OverlayLogger.error('Location API failed', error);
        // Mark location as loaded so it doesn't block the overlay
        setIsLoading(prev => ({ ...prev, location: false }));
      }
    } else if (API_KEYS.LOCATIONIQ) {
      // Rate limited - skip this update
              OverlayLogger.location('Location update skipped due to rate limiting', { 
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
      OverlayLogger.warn('No LocationIQ API key - marking location as loaded');
    }
  }, [settings.locationDisplay, clearError]); // Include locationDisplay dependency to get current setting

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
            
            // RTIRL doesn't provide weather data - weather comes from Open-Meteo API
            // Mark weather as loaded if we're still loading (weather will come from API)
            if (currentIsLoading.current.weather) {
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
                OverlayLogger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
              } catch (error) {
                OverlayLogger.error('Failed to set timezone from RTIRL', error);
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
            } else {
              // RTIRL GPS failed
              OverlayLogger.warn('RTIRL GPS data invalid');
              OverlayLogger.error('No GPS data available');
            }
          });
        } else {
          setError('rtirl', 'RealtimeIRL API not available or missing API key');
          OverlayLogger.warn('RealtimeIRL API not available or missing API key');
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



  // === 🔄 ERROR MONITORING ===
  // Track errors for debugging and potential future recovery
  useEffect(() => {
    const hasErrors = Object.values(errors).some(error => error !== null);
    if (hasErrors) {
      OverlayLogger.warn('Service errors detected', errors);
    }
  }, [errors, setError]);

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
          
          if (!response.ok) {
            if (response.status === 401) {
              // Not authenticated - stop polling
              OverlayLogger.settings('Not authenticated, stopping polling');
              stopPolling();
              return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
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
          OverlayLogger.error('Smart polling failed', err);
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
        .then(res => {
          if (!res.ok) {
            if (res.status === 401) {
              // Not authenticated - use default settings
              OverlayLogger.settings('Not authenticated, using default settings');
              setSettings(DEFAULT_OVERLAY_SETTINGS);
              return;
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then(data => {
          if (data) {
            setSettings(data);
            // Update last known modified timestamp
            if (data._lastModified) {
              lastKnownModified = data._lastModified;
            }
          }
        })
        .catch(err => {
          OverlayLogger.error('Failed to load initial settings', err);
          // Use default settings on error
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        });
      
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
            const { ...settingsOnly } = data;
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
          OverlayLogger.error('Failed to parse settings update', error);
        }
      };
      
      eventSource.onerror = (error) => {
        const readyState = eventSource?.readyState;
        OverlayLogger.error(`❌ SSE connection error (ReadyState: ${readyState})`, error);
        
        // If SSE fails, ensure we have default settings
        if (!settings.locationDisplay || settings.showWeather === undefined || settings.showMinimap === undefined) {
          OverlayLogger.settings('SSE failed, ensuring default settings are loaded');
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        }
        
        // Handle different ready states
        if (readyState === EventSource.CLOSED) {
          // Connection was closed, try to reconnect
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), 30000);
          
          OverlayLogger.settings(`SSE connection closed, attempting reconnect #${reconnectAttempts} in ${delay}ms`);
          
          // Start polling only after 5 failed attempts
          if (reconnectAttempts >= 5 && !isPolling) {
            OverlayLogger.settings('Multiple SSE failures, switching to polling mode');
            startSmartPolling();
          }
          
          reconnectTimeout = setTimeout(() => {
            connectSSE();
          }, delay);
        } else if (readyState === EventSource.CONNECTING) {
          // Still connecting, wait a bit longer
          OverlayLogger.settings('SSE still connecting, waiting...');
        } else {
          // Unknown state, try to reconnect
          OverlayLogger.settings('SSE in unknown state, attempting reconnect');
          reconnectAttempts++;
          const delay = 5000; // 5 second delay for unknown states
          
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
    console.log(`[MINIMAP] Current speed: ${kmh.toFixed(2)} km/h`);

    if (kmh >= THRESHOLDS.SPEED_SHOW) {
      speedAboveThresholdCount.current++;
      console.log(`[MINIMAP] Speed above threshold (${THRESHOLDS.SPEED_SHOW} km/h): count = ${speedAboveThresholdCount.current}`);

      if (speedAboveThresholdCount.current >= THRESHOLDS.SPEED_READINGS_REQUIRED) {
        if (!speedBasedVisible.current) {
          speedBasedVisible.current = true;
          console.log('[MINIMAP] Minimap shown due to speed');
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
          console.log('[MINIMAP] Minimap hidden due to speed drop');
        }, TIMERS.SPEED_HIDE_DELAY);
        console.log(`[MINIMAP] Speed below threshold, will hide minimap in ${TIMERS.SPEED_HIDE_DELAY / 1000}s`);
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

    return () => {
      clearTimeout(overlayTimeout);
      // Clean up any remaining timeouts to prevent memory leaks
      if (weatherRefreshTimer.current) clearTimeout(weatherRefreshTimer.current);
      if (minimapTimeout.current) clearTimeout(minimapTimeout.current);
      if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
    };
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
  }, [settings.locationDisplay, settings.showMinimap, settings.showWeather, location, setLocation]);

  // === 🎨 RENDER OVERLAY ===
  
  return (
    <ErrorBoundary>
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
      {/* Debug: isLocationEnabled={isLocationEnabled}, showWeather={settings.showWeather}, shouldShowMinimap={shouldShowMinimap()} */}
      {/* Always show right side if any feature is enabled, even if loading */}
      {(isLocationEnabled || settings.showWeather || shouldShowMinimap()) && (
        <div className="top-right">
          {/* Stream Info - Live Status Display */}
          <div className="overlay-container">
            
            {settings.locationDisplay && (
              <div className="location" style={{ display: settings.locationDisplay === 'hidden' ? 'none' : 'flex' }}>
                {isLoading.location ? (
                  <span>Loading location...</span>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            )}
            
            {settings.showWeather && (
              <div className="weather">
                {isLoading.weather ? (
                  <div className="weather-container">
                    <div className="weather-content">
                      <div className="weather-description">Loading weather...</div>
                      <div className="weather-temperature">--°C / --°F</div>
                    </div>
                  </div>
                ) : weather ? (
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
                ) : null}
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
              {/* Show speed if autoshow is active and minimap is visible due to speed */}
              {settings.minimapSpeedBased && speedBasedVisible.current && (
                <div className="minimap-speed" style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 18, fontWeight: 600, zIndex: 2 }}>
                  {`${(speed * 3.6).toFixed(1)} km/h`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
