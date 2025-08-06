"use client";

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
import dynamic from 'next/dynamic';

import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import HeartRateMonitor from '@/components/HeartRateMonitor';
import KickSubGoal from '@/components/KickSubGoal';

import { 
  fetchWeatherAndTimezoneFromOpenMeteo,
  fetchLocationFromLocationIQ,
  WeatherTimezoneResponse,
} from '@/utils/api-utils';
import {
  formatLocation,
  distanceInMeters,
  isValidCoordinate,
  LocationData,
} from '@/utils/overlay-utils';
import { OverlayLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';

// Import extracted utilities and constants
import { 
  TIMERS, 
  THRESHOLDS, 
  API_KEYS,
  type RTIRLPayload
} from '@/utils/overlay-constants';
import {
  kmhToMph,
  getAdaptiveDistanceThreshold,
  getSpeedKmh,
  isAboveSpeedThreshold
} from '@/utils/speed-utils';
import {
  getWeatherIcon,
  getWeatherFallback,
  celsiusToFahrenheit
} from '@/utils/weather-utils';

const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});









export default function OverlayPage() {
  useRenderPerformance('OverlayPage');

  // Filter out RTIRL Firebase cookie warnings to clean up console
  useEffect(() => {
    const originalWarn = console.warn;
    const filteredWarn = (...args: Parameters<typeof console.warn>) => {
      const message = args[0];
      if (typeof message === 'string' && message.includes('Cookie "" has been rejected as third-party')) {
        return; // Suppress RTIRL cookie warnings
      }
      originalWarn.apply(console, args);
    };
    
    console.warn = filteredWarn;

    return () => {
      console.warn = originalWarn;
    };
  }, []);

  const [time, setTime] = useState('Loading...');
  const [date, setDate] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string; originalData?: LocationData } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
  const [speedIndicatorVisible, setSpeedIndicatorVisible] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sunrise, setSunrise] = useState<string | null>(null);
  const [sunset, setSunset] = useState<string | null>(null);
  const [minimapOpacity, setMinimapOpacity] = useState(1);
  const [isLoading, setIsLoading] = useState({
    weather: true,
    location: true,
    timezone: true
  });
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [subGoalData, setSubGoalData] = useState<{
    currentSubs?: number;
    latestSub?: string | null;
    lastUpdate?: number;
  } | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);


  const lastAPICoords = useRef<[number, number] | null>(null);
  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastLocationUpdate = useRef(0);

  

  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);
  const isFirstLoad = useRef(true); // Track if this is the first load
  const timeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  




  




  const createDateTimeFormatters = useCallback((timezone: string) => {
    formatter.current = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    dateFormatter.current = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    });
  }, []);

  const setLoadingState = useCallback((type: 'weather' | 'timezone' | 'location', loading: boolean) => {
    setIsLoading(prev => ({ ...prev, [type]: loading }));
  }, []);

  const processWeatherResult = useCallback(async (result: WeatherTimezoneResponse | null, isInitial = false) => {
    if (!result) {
      OverlayLogger.warn('Weather API failed');
      setWeather(null);
      setLoadingState('weather', false);
      return;
    }

    if (result.weather) {
      setWeather(result.weather);
      setLoadingState('weather', false);
      OverlayLogger.weather(isInitial ? 'Initial weather data loaded' : 'Weather data updated successfully', result.weather);
    } else {
      setLoadingState('weather', false);
    }
    
    if (result.sunrise && result.sunset) {
      setSunrise(result.sunrise);
      setSunset(result.sunset);
    }
    
    if (result.timezone && result.timezone !== timezone) {
      try {
        createDateTimeFormatters(result.timezone);
        setTimezone(result.timezone);
        setLoadingState('timezone', false);
        OverlayLogger.overlay(isInitial ? 'Initial timezone set' : 'Timezone updated successfully', { timezone: result.timezone });
      } catch (error) {
        OverlayLogger.error(isInitial ? 'Failed to set initial timezone' : 'Failed to set timezone', error);
        setLoadingState('timezone', false);
      }
    }
  }, [timezone, createDateTimeFormatters, setLoadingState]);

  const updateFromCoordinates = useCallback(async (lat: number, lon: number) => {
    if (!isValidCoordinate(lat, lon)) {
      OverlayLogger.error('Invalid coordinates received', { lat, lon });
      return;
    }
    
    // Ensure we have valid coordinates before making any API calls
    if (lat === 0 && lon === 0) {
      OverlayLogger.warn('Received zero coordinates, skipping API calls');
      return;
    }
    
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    // On first load, always fetch fresh data regardless of cooldowns
    const isFirstLoadNow = isFirstLoad.current;
    if (isFirstLoadNow) {
      isFirstLoad.current = false;
      OverlayLogger.overlay('First load detected - fetching fresh API data immediately', { lat, lon });
    }
    
    // Fetch weather data (if we don't have it or it's first load)
    if (!hadCoords || isFirstLoadNow) {
      const currentTime = Date.now();
      const cooldown = isFirstLoadNow ? TIMERS.FIRST_LOAD_API_COOLDOWN : TIMERS.API_COOLDOWN;
      
      if ((currentTime - lastWeatherAPICall.current) >= cooldown) {
        lastWeatherAPICall.current = currentTime;
        try {
          OverlayLogger.overlay('Fetching weather data from API', { lat, lon });
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result, isFirstLoadNow);
        } catch (error) {
          OverlayLogger.error('Weather update failed', error);
          setWeather(null);
          setLoadingState('weather', false);
        }
      } else {
        const remainingCooldown = cooldown - (currentTime - lastWeatherAPICall.current);
        OverlayLogger.overlay('Weather API call skipped due to cooldown', { remainingMs: remainingCooldown });
        setLoadingState('weather', false);
      }
    }
    
    // Fetch location name data (if we don't have it or it's first load or moved enough)
    const now = Date.now();
    
    // Calculate adaptive distance threshold based on current speed
    const speedKmh = speed * 3.6; // Convert m/s to km/h
    const adaptiveDistanceThreshold = getAdaptiveDistanceThreshold(speedKmh);
    
    const shouldUpdateLocation = isFirstLoadNow || !lastAPICoords.current || (
      distanceInMeters(lat, lon, lastAPICoords.current![0], lastAPICoords.current![1]) >= adaptiveDistanceThreshold &&
      (now - lastLocationUpdate.current) >= TIMERS.LOCATION_UPDATE
    );
    
    if (!shouldUpdateLocation) {
      if (lastAPICoords.current) {
        const distance = distanceInMeters(lat, lon, lastAPICoords.current[0], lastAPICoords.current[1]);
        const timeSinceUpdate = now - lastLocationUpdate.current;
        OverlayLogger.overlay('Location update skipped', { 
          distance, 
          adaptiveThreshold: adaptiveDistanceThreshold,
          speedKmh,
          timeSinceUpdate,
          timeThreshold: TIMERS.LOCATION_UPDATE
        });
      } else {
        OverlayLogger.overlay('Location update skipped - no previous coordinates');
      }
      return;
    }
    
    lastAPICoords.current = [lat, lon];
    
    if (API_KEYS.LOCATIONIQ) {
      const cooldown = isFirstLoadNow ? TIMERS.FIRST_LOAD_API_COOLDOWN : TIMERS.API_COOLDOWN;
      
      if ((now - lastLocationAPICall.current) >= cooldown) {
        lastLocationAPICall.current = now;
        try {
          OverlayLogger.overlay('Fetching location name from API', { lat, lon });
          const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
          if (loc) {
            const label = formatLocation(loc, settings.locationDisplay);
            setLocation({ label, countryCode: loc.countryCode || '', originalData: loc });
            setLoadingState('location', false);
            lastLocationUpdate.current = now;
            
            // Only update timezone from LocationIQ if RTIRL didn't provide one
            if (loc.timezone && !currentTimezone.current && loc.timezone !== currentTimezone.current) {
              try {
                createDateTimeFormatters(loc.timezone);
                setTimezone(loc.timezone);
                setLoadingState('timezone', false);
                OverlayLogger.overlay('Timezone updated from LocationIQ (fallback)', { timezone: loc.timezone });
              } catch (error) {
                OverlayLogger.error('Failed to set timezone from LocationIQ', error);
                setLoadingState('timezone', false);
              }
            }
          } else {
            setLoadingState('location', false);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          OverlayLogger.error(`Location API failed: ${errorMessage}`);
          setLoadingState('location', false);
        }
      } else {
        const remainingCooldown = cooldown - (now - lastLocationAPICall.current);
        OverlayLogger.overlay('Location API call skipped due to cooldown', { remainingMs: remainingCooldown });
        // Don't set loading to false here - keep it loading until we get data
      }
    } else {
      OverlayLogger.warn('LocationIQ API key not available');
      setLoadingState('location', false);
    }
  }, [settings.locationDisplay, processWeatherResult, setLoadingState, createDateTimeFormatters, speed]);

  const shouldShowMinimap = useCallback(() => {
    // If location is hidden, never show minimap
    if (settings.locationDisplay === 'hidden') {
      return false;
    }
    
    // If speed-based mode is enabled, show only when moving
    if (settings.minimapSpeedBased) {
      return minimapOpacity > 0 && mapCoords;
    }
    
    // If manual mode is enabled, show when we have coordinates
    if (settings.showMinimap) {
      return mapCoords !== null;
    }
    
    // Default: don't show
    return false;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, minimapOpacity]);

  const isLocationEnabled = settings.locationDisplay && settings.locationDisplay !== 'hidden';
  const isOverlayReady = useMemo(() => !isLoading.timezone, [isLoading.timezone]);

  // Memoize weather icon to prevent unnecessary recalculations
  const weatherIcon = useMemo(() => {
    if (!weather?.icon || !timezone) return null;
    return getWeatherIcon(weather.icon, timezone, sunrise, sunset);
  }, [weather?.icon, timezone, sunrise, sunset, time]); // Add time dependency to refresh on time changes

  useEffect(() => {
    const eventSource = new EventSource('/api/settings-stream');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'settings_update') {
          if (data._subGoalData) {
            setSubGoalData(data._subGoalData);
          }
          
          // Only update settings if they've actually changed
          const hasMinimapChanges = data.showMinimap !== settings.showMinimap || 
                                   data.minimapSpeedBased !== settings.minimapSpeedBased ||
                                   data.locationDisplay !== settings.locationDisplay;
          
          if (hasMinimapChanges) {
            OverlayLogger.settings(`Minimap settings updated: showMinimap=${data.showMinimap}, speedBased=${data.minimapSpeedBased}, locationDisplay=${data.locationDisplay}`);
          }
          
          setSettings(data);
        }
      } catch (error) {
        OverlayLogger.error('Failed to parse SSE message:', error);
      }
    };
    
    eventSource.onerror = () => {
      setTimeout(() => eventSource.close(), 5000);
    };
    
    return () => {
      eventSource.close();
    };
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay]);

  useEffect(() => {
    currentSettings.current = settings;
  }, [settings]);

  useEffect(() => {
    currentIsLoading.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    currentTimezone.current = timezone;
  }, [timezone]);

  useEffect(() => {
    // Update minimap visibility when settings change
    if (settings.locationDisplay === 'hidden') {
      // Location is hidden: force hide minimap
      setMinimapOpacity(0);
    } else if (settings.minimapSpeedBased) {
      // Speed-based mode: visibility controlled by speed threshold
      // (handled by the speed effect)
    } else if (settings.showMinimap) {
      // Manual mode: show if we have coordinates
      setMinimapOpacity(mapCoords ? 1 : 0);
    } else {
      // Hidden mode: ensure hidden
      setMinimapOpacity(0);
    }
  }, [settings.minimapSpeedBased, settings.showMinimap, settings.locationDisplay, mapCoords]);

  useEffect(() => {
    const hasRequiredSettings = settings.locationDisplay !== undefined && 
                               settings.showWeather !== undefined && 
                               settings.showMinimap !== undefined;
    
    if (!hasRequiredSettings) {
      setSettings(DEFAULT_OVERLAY_SETTINGS);
    }
  }, [settings]);

  useEffect(() => {
    if (isOverlayReady && !overlayVisible) {
      const delay = setTimeout(() => setOverlayVisible(true), 200);
      return () => clearTimeout(delay);
    } else if (!isOverlayReady && overlayVisible) {
      setOverlayVisible(false);
    }
  }, [isOverlayReady, overlayVisible]);

  useEffect(() => {
    if (!timezone || !formatter.current || !dateFormatter.current) return;
    
    function updateTimeAndDate() {
      const now = new Date();
      const timeParts = formatter.current!.formatToParts(now);
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
        
        // Store interval reference for cleanup
        timeIntervalRef.current = interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    return () => {
      clearTimeout(timeout);
      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current);
        timeIntervalRef.current = null;
      }
    };
  }, [timezone]);

  useEffect(() => {
    if (!lastWeatherCoords.current) return;
    
    const interval = setInterval(async () => {
      const now = Date.now();
      if ((now - lastWeatherAPICall.current) >= TIMERS.WEATHER_TIMEZONE_UPDATE) {
        lastWeatherAPICall.current = now;
        const [lat, lon] = lastWeatherCoords.current!;
        
        try {
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          OverlayLogger.error(`Weather update failed: ${errorMessage}`);
          setWeather(null);
          setLoadingState('weather', false);
        }
      }
    }, TIMERS.WEATHER_TIMEZONE_UPDATE);
    
    return () => clearInterval(interval);
  }, [processWeatherResult, setLoadingState]);

  useEffect(() => {
    // Load RTIRL script immediately without delay
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
    script.async = true;
    script.onerror = () => {
      OverlayLogger.error('Failed to load RTIRL script');
    };
    document.body.appendChild(script);
    
    script.onload = () => {
      OverlayLogger.overlay('RTIRL script loaded, initializing connection...');
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        OverlayLogger.overlay('RTIRL API available, setting up listener...');
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          if (!p || typeof p !== 'object') return;
          const payload = p as RTIRLPayload;
          
          // Handle speed data immediately
          if (typeof payload.speed === 'number') {
            // Debug logging for speed calculation
            const rawSpeed = payload.speed;
            const speedKmh = rawSpeed * 3.6;
            const speedMph = speedKmh * 0.621371;
            
            OverlayLogger.overlay('RTIRL Speed Data Debug', {
              rawSpeed,
              speedKmh: Math.round(speedKmh * 10) / 10,
              speedMph: Math.round(speedMph * 10) / 10,
              timestamp: Date.now()
            });
            
            setSpeed(payload.speed);
          }
          
          // Handle timezone from RTIRL FIRST (before API calls)
          if (payload.location?.timezone && payload.location.timezone !== currentTimezone.current) {
            try {
              createDateTimeFormatters(payload.location.timezone);
              setTimezone(payload.location.timezone);
              setLoadingState('timezone', false);
              OverlayLogger.overlay('Timezone updated from RTIRL', { timezone: payload.location.timezone });
            } catch (error) {
              OverlayLogger.error('Failed to set timezone from RTIRL', error);
              setLoadingState('timezone', false);
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
          
          if (lat !== null && lon !== null && isValidCoordinate(lat, lon)) {
            OverlayLogger.overlay('RTIRL GPS data received', { lat, lon, isFirstLoad: isFirstLoad.current });
            
            // Update map coordinates immediately
            setMapCoords([lat, lon]);
            

            
            // Now fetch additional data (location name, weather) from APIs
            updateFromCoordinates(lat, lon);
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
    
    // Cleanup function
    return () => {
      // RTIRL script cleanup handled automatically
    };
  }, [updateFromCoordinates, createDateTimeFormatters, setLoadingState]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/get-settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        if (data) {
          setSettings(data);
          if (data._subGoalData) {
            setSubGoalData(data._subGoalData);
          }
        } else {
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        }
      } catch (error) {
        OverlayLogger.error('Failed to load settings, using defaults:', error);
        setSettings(DEFAULT_OVERLAY_SETTINGS);
      }
    };
    
    loadSettings();
  }, []);



  // Simplified speed indicator visibility - just show when above threshold
  useEffect(() => {
    if (!settings.showSpeed) {
      setSpeedIndicatorVisible(false);
      return;
    }

    const kmh = getSpeedKmh(speed);
    const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);
    
    setSpeedIndicatorVisible(isAboveThreshold);
  }, [speed, settings.showSpeed]);

  // Simplified minimap visibility - just show when above threshold
  useEffect(() => {
    if (!settings.minimapSpeedBased || settings.locationDisplay === 'hidden') {
      setMinimapOpacity(0);
      return;
    }

    const kmh = getSpeedKmh(speed);
    const isAboveThreshold = isAboveSpeedThreshold(kmh, THRESHOLDS.SPEED_SHOW);
    
    setMinimapOpacity(isAboveThreshold ? 1 : 0);
  }, [speed, settings.minimapSpeedBased, settings.locationDisplay]);

  // Simplified speed display - no animation, just show raw speed
  const currentSpeedKmh = useMemo(() => getSpeedKmh(speed), [speed]);
  const currentSpeedMph = useMemo(() => Math.round(kmhToMph(currentSpeedKmh)), [currentSpeedKmh]);
  const displaySpeedKmh = useMemo(() => Math.round(currentSpeedKmh), [currentSpeedKmh]);

  // Force weather icon refresh around sunrise/sunset times
  useEffect(() => {
    if (!timezone || !sunrise || !sunset) return;

    const checkDayNightTransition = () => {
      try {
        const now = new Date();
        const currentLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const sunriseTime = new Date(sunrise);
        const sunsetTime = new Date(sunset);
        
        // Check if we're within 30 minutes of sunrise or sunset
        const timeToSunrise = Math.abs(currentLocal.getTime() - sunriseTime.getTime());
        const timeToSunset = Math.abs(currentLocal.getTime() - sunsetTime.getTime());
        const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
        
        if (timeToSunrise < thirtyMinutes || timeToSunset < thirtyMinutes) {
          // Force a time update to trigger weather icon refresh
          setTime(prev => prev); // This will trigger the time update effect
          OverlayLogger.overlay('Weather icon refresh triggered for day/night transition');
        }
      } catch (error) {
        OverlayLogger.error('Error checking day/night transition:', error);
      }
    };

    // Check every 5 minutes for day/night transitions
    const interval = setInterval(checkDayNightTransition, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [timezone, sunrise, sunset]);

  // Overlay visibility timeout
  useEffect(() => {
    const overlayTimeout = setTimeout(() => {
      const hasConfiguredElements = currentSettings.current.locationDisplay || 
                                   currentSettings.current.showWeather || 
                                   (currentSettings.current.showMinimap || 
                                    (currentSettings.current.minimapSpeedBased && minimapOpacity > 0));
      
      const dataReady = !currentIsLoading.current.weather && 
                       !currentIsLoading.current.location && 
                       !currentIsLoading.current.timezone;
      
      if (!hasConfiguredElements || !dataReady) {
        setIsLoading({ weather: false, location: false, timezone: false });
      }
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000);

    return () => {
      clearTimeout(overlayTimeout);
    };
  }, [minimapOpacity]);

  return (
    <ErrorBoundary>
      <div id="overlay" className={overlayVisible ? 'show' : ''}>
        <div className="top-left">
          <div className="overlay-container">
            {timezone && (
              <div className="time time-left">
                <div className="time-display">
                  <span className="time-main">{time.split(' ')[0]}</span>
                  <span className="time-ampm">{time.split(' ')[1]}</span>
                </div>
              </div>
            )}
            
            {timezone && (
              <div className="date date-left">
                {date}
              </div>
            )}
            
            <HeartRateMonitor 
              pulsoidToken={API_KEYS.PULSOID} 
            />
          </div>
        </div>

        {(isLocationEnabled || settings.showWeather || (settings.showMinimap || settings.minimapSpeedBased)) && (
          <div className="top-right">
            <div className="overlay-container">
              {settings.locationDisplay && settings.locationDisplay !== 'hidden' && location && location.label && (
                <div className="location">
                  {location.label}
                  {location.countryCode && (
                    <img
                      src={`https://flagcdn.com/${location.countryCode}.svg`}
                      alt={`Country: ${location.label}`}
                      width={32}
                      height={20}
                      className="location-flag"
                    />
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
                      <div className="weather-icon">
                        <img
                          src={`https://openweathermap.org/img/wn/${weatherIcon || '01d'}@4x.png`}
                          alt={`Weather: ${weather.desc}`}
                          width={24}
                          height={24}
                          className="weather-icon"
                          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                            // Fallback to a simple text representation if image fails
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            
                            // Show loading briefly, then fallback
                            const fallback = document.createElement('div');
                            fallback.className = 'weather-icon-fallback';
                            fallback.textContent = '⏳'; // Loading indicator
                            target.parentNode?.appendChild(fallback);
                            
                            // Replace with actual fallback after brief delay
                            setTimeout(() => {
                              fallback.textContent = weather?.icon ? getWeatherFallback(weather.icon) : '🌤️';
                            }, 100);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              
              {/* Speed Indicator */}
              {settings.showSpeed && speedIndicatorVisible && (
                <div className="speed-indicator">
                  <div className="speed-content">
                    <div className="speed-value">
                      {currentSpeedMph}
                    </div>
                    <div className="speed-label">
                      MPH
                    </div>
                  </div>
                  <div className="speed-separator">/</div>
                  <div className="speed-content">
                    <div className="speed-value">
                      {displaySpeedKmh}
                    </div>
                    <div className="speed-label">
                      KM/H
                    </div>
                  </div>
                </div>
              )}
            </div>

            {shouldShowMinimap() && (
              <div className="minimap" style={{ opacity: minimapOpacity, transition: 'opacity 0.2s ease-in-out' }}>
                {mapCoords ? (
                  <MapboxMinimap 
                    lat={mapCoords[0]} 
                    lon={mapCoords[1]} 
                    isVisible={true}
                  />
                ) : (
                  <div className="minimap-placeholder">
                    <div className="placeholder-content">
                      <div className="placeholder-icon">🗺️</div>
                      <div className="placeholder-text">
                        {settings.minimapSpeedBased ? 'Waiting for movement...' : 'Waiting for GPS...'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

                 <KickSubGoal 
           channelName={settings.kickChannelName}
           dailyGoal={settings.kickDailySubGoal}
           isVisible={settings.showKickSubGoal}
           showLatestSub={settings.showLatestSub}
           showLeaderboard={settings.showSubLeaderboard}
           enableRollingSubGoal={settings.enableRollingSubGoal}
           rollingSubGoalIncrement={settings.rollingSubGoalIncrement}
           subGoalData={subGoalData}
         />
      </div>
    </ErrorBoundary>
  );
}


