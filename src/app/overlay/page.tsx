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
import Image from 'next/image';
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
  capitalizeWords,
  celsiusToFahrenheit,
  LocationData,
} from '@/utils/overlay-utils';
import { OverlayLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';

const MapboxMinimap = dynamic(() => import('@/components/MapboxMinimap'), {
  ssr: false,
  loading: () => <div />
});

function getWeatherIcon(icon: string, timezone: string | null, sunrise: string | null, sunset: string | null): string {
  const baseIcon = icon.replace(/([dn])$/, '').replace(/@\dx$/, '');
  if (!timezone) return baseIcon + 'd';

  try {
    const now = new Date();
    const currentLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    let isDay = true;

    if (sunrise && sunset) {
      const sunriseTime = new Date(sunrise);
      const sunsetTime = new Date(sunset);
      isDay = currentLocal >= sunriseTime && currentLocal < sunsetTime;
    } else {
      const hour = currentLocal.getHours();
      isDay = hour >= 6 && hour < 18;
    }

    return baseIcon + (isDay ? 'd' : 'n');
  } catch {
    return baseIcon + 'd';
  }
}

const TIMERS = {
  WEATHER_TIMEZONE_UPDATE: 300000,
  LOCATION_UPDATE: 60000,
  OVERLAY_FADE_TIMEOUT: 5000,
  MINIMAP_HIDE_DELAY: 30000,
  SPEED_HIDE_DELAY: 5000,
  API_COOLDOWN: 60000,
} as const;

const THRESHOLDS = {
  LOCATION_DISTANCE: 100,
  SPEED_SHOW: 10,
  SPEED_READINGS_REQUIRED: 2,
} as const;

const API_KEYS = {
  RTIRL: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
  LOCATIONIQ: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
  PULSOID: process.env.NEXT_PUBLIC_PULSOID_TOKEN,
  MAPBOX: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
} as const;

interface RTIRLPayload {
  speed?: number;
  location?: { lat: number; lon: number; countryCode?: string; timezone?: string };
}

export default function OverlayPage() {
  useRenderPerformance('OverlayPage');

  const [time, setTime] = useState('Loading...');
  const [date, setDate] = useState('Loading...');
  const [location, setLocation] = useState<{ label: string; countryCode: string; originalData?: LocationData } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [speed, setSpeed] = useState(0);
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

  const heartRateRef = useRef<HTMLDivElement>(null);
  const lastAPICoords = useRef<[number, number] | null>(null);
  const lastWeatherCoords = useRef<[number, number] | null>(null);
  const lastLocationUpdate = useRef(0);
  const minimapTimeout = useRef<NodeJS.Timeout | null>(null);
  const speedBasedVisible = useRef(false);
  const speedAboveThresholdCount = useRef(0);
  const speedHideTimeout = useRef<NodeJS.Timeout | null>(null);
  const formatter = useRef<Intl.DateTimeFormat | null>(null);
  const dateFormatter = useRef<Intl.DateTimeFormat | null>(null);
  const currentSettings = useRef(settings);
  const currentIsLoading = useRef(isLoading);
  const currentTimezone = useRef(timezone);
  const lastWeatherAPICall = useRef(0);
  const lastLocationAPICall = useRef(0);

  const safeSettings = useMemo(() => ({ ...DEFAULT_OVERLAY_SETTINGS, ...settings }), [settings]);

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
    
    const hadCoords = lastWeatherCoords.current !== null;
    lastWeatherCoords.current = [lat, lon];
    
    if (!hadCoords && currentIsLoading.current.weather) {
      const currentTime = Date.now();
      if ((currentTime - lastWeatherAPICall.current) >= TIMERS.API_COOLDOWN) {
        lastWeatherAPICall.current = currentTime;
        try {
          const result = await fetchWeatherAndTimezoneFromOpenMeteo(lat, lon);
          await processWeatherResult(result, true);
        } catch (error) {
          OverlayLogger.error('Initial weather update failed', error);
          setWeather(null);
          setLoadingState('weather', false);
        }
      } else {
        setLoadingState('weather', false);
      }
    }
    
    const now = Date.now();
    const shouldUpdateLocation = !lastAPICoords.current || (
      distanceInMeters(lat, lon, lastAPICoords.current![0], lastAPICoords.current![1]) >= THRESHOLDS.LOCATION_DISTANCE &&
      (now - lastLocationUpdate.current) >= TIMERS.LOCATION_UPDATE
    );
    
    if (!shouldUpdateLocation) return;
    
    lastAPICoords.current = [lat, lon];
    
    if (API_KEYS.LOCATIONIQ && (now - lastLocationAPICall.current) >= TIMERS.API_COOLDOWN) {
      lastLocationAPICall.current = now;
      try {
        const loc = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
        if (loc) {
          const label = formatLocation(loc, settings.locationDisplay);
          setLocation({ label, countryCode: loc.countryCode || '', originalData: loc });
          setLoadingState('location', false);
          lastLocationUpdate.current = now;
          
          if (loc.timezone && loc.timezone !== currentTimezone.current) {
            try {
              createDateTimeFormatters(loc.timezone);
              setTimezone(loc.timezone);
              setLoadingState('timezone', false);
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
      setLoadingState('location', false);
    }
  }, [settings.locationDisplay, processWeatherResult, setLoadingState, createDateTimeFormatters]);

  const shouldShowMinimap = useCallback(() => {
    // If location is hidden, never show minimap
    if (settings.locationDisplay === 'hidden') {
      return false;
    }
    
    // If speed-based mode is enabled, show only when moving
    if (settings.minimapSpeedBased) {
      return speedBasedVisible.current && mapCoords;
    }
    
    // If manual mode is enabled, show when we have coordinates
    if (settings.showMinimap) {
      return mapCoords !== null;
    }
    
    // Default: don't show
    return false;
  }, [mapCoords, settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay]);

  const isLocationEnabled = settings.locationDisplay && settings.locationDisplay !== 'hidden';
  const isOverlayReady = useMemo(() => !isLoading.timezone, [isLoading.timezone]);

  useEffect(() => {
    const eventSource = new EventSource('/api/settings-stream');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'settings_update') {
          if (data._subGoalData) {
            setSubGoalData(data._subGoalData);
          }
          
          // Log minimap-related settings changes
          if (data.showMinimap !== settings.showMinimap || 
              data.minimapSpeedBased !== settings.minimapSpeedBased ||
              data.locationDisplay !== settings.locationDisplay) {
            OverlayLogger.settings(`Minimap settings updated: showMinimap=${data.showMinimap}, speedBased=${data.minimapSpeedBased}, locationDisplay=${data.locationDisplay}`);
          }
          
          setSettings(data);
        }
      } catch (error) {
        console.error('Overlay: Failed to parse SSE message:', error);
      }
    };
    
    eventSource.onerror = () => {
      setTimeout(() => eventSource.close(), 5000);
    };
    
    return () => eventSource.close();
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
    // Reset minimap state when settings change
    if (settings.minimapSpeedBased) {
      // Speed-based mode: start hidden
      speedBasedVisible.current = false;
      speedAboveThresholdCount.current = 0;
      setMinimapOpacity(0);
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
    } else if (settings.showMinimap) {
      // Manual mode: start visible if we have coordinates
      speedBasedVisible.current = false;
      speedAboveThresholdCount.current = 0;
      setMinimapOpacity(1);
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
    } else {
      // Hidden mode: ensure hidden
      speedBasedVisible.current = false;
      speedAboveThresholdCount.current = 0;
      setMinimapOpacity(0);
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
    }
  }, [settings.minimapSpeedBased, settings.showMinimap, settings.locationDisplay]);

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
        
        return interval;
      }, msUntilNextMinute);
      
      return syncTimeout;
    }
    
    const timeout = setupNextSync();
    return () => clearTimeout(timeout);
  }, [timezone]);

  useEffect(() => {
    if (!lastWeatherCoords.current) return;
    
    const interval = setInterval(async () => {
      const now = Date.now();
      if ((now - lastWeatherAPICall.current) >= TIMERS.API_COOLDOWN) {
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
            
            if (typeof payload.speed === 'number') {
              setSpeed(payload.speed);
            }
            
            if (currentIsLoading.current.weather) {
              setLoadingState('weather', false);
            }
            if (currentIsLoading.current.location) {
              setLoadingState('location', false);
            }
            
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
              updateFromCoordinates(lat, lon);
              setMapCoords([lat, lon]);
              
              if (minimapTimeout.current) {
                clearTimeout(minimapTimeout.current);
              }
              if (!currentSettings.current.showMinimap) {
                minimapTimeout.current = setTimeout(() => {
                  setMapCoords(null);
                }, TIMERS.MINIMAP_HIDE_DELAY);
              }
            } else {
              OverlayLogger.warn('RTIRL GPS data invalid');
            }
          });
        } else {
          OverlayLogger.warn('RealtimeIRL API not available or missing API key');
        }
      };
    }, 1000);
    
    return () => clearTimeout(initTimeout);
  }, [updateFromCoordinates]);

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
        console.error('Overlay: Failed to load settings, using defaults:', error);
        setSettings(DEFAULT_OVERLAY_SETTINGS);
      }
    };
    
    loadSettings();
  }, []);

  useEffect(() => {
    // Clear any existing timeout when settings change
    if (minimapTimeout.current) {
      clearTimeout(minimapTimeout.current);
      minimapTimeout.current = null;
    }
    
    // If minimap should be hidden and we have coordinates, set a timeout to clear them
    if (!shouldShowMinimap() && mapCoords) {
      minimapTimeout.current = setTimeout(() => {
        setMapCoords(null);
      }, TIMERS.MINIMAP_HIDE_DELAY);
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, mapCoords, shouldShowMinimap]);

  useEffect(() => {
    // Reset speed-based state when mode changes
    if (!settings.minimapSpeedBased) {
      speedBasedVisible.current = false;
      speedAboveThresholdCount.current = 0;
      setMinimapOpacity(1);
      if (speedHideTimeout.current) {
        clearTimeout(speedHideTimeout.current);
        speedHideTimeout.current = null;
      }
      return;
    }

    // Only process speed-based logic if speed-based mode is enabled
    if (settings.minimapSpeedBased) {
      const kmh = speed * 3.6;
      const isAboveThreshold = kmh >= THRESHOLDS.SPEED_SHOW;

      if (isAboveThreshold) {
        speedAboveThresholdCount.current++;
        
        if (speedAboveThresholdCount.current >= THRESHOLDS.SPEED_READINGS_REQUIRED) {
          if (speedHideTimeout.current) {
            clearTimeout(speedHideTimeout.current);
            speedHideTimeout.current = null;
          }
          
          if (!speedBasedVisible.current) {
            speedBasedVisible.current = true;
            setMinimapOpacity(1);
          }
        }
      } else {
        speedAboveThresholdCount.current = 0;
        
        if (speedBasedVisible.current && !speedHideTimeout.current) {
          speedHideTimeout.current = setTimeout(() => {
            speedBasedVisible.current = false;
            setMinimapOpacity(0);
            speedHideTimeout.current = null;
          }, TIMERS.SPEED_HIDE_DELAY);
        }
      }
    }
  }, [speed, settings.minimapSpeedBased]);

  useEffect(() => {
    const overlayTimeout = setTimeout(() => {
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
    }, TIMERS.OVERLAY_FADE_TIMEOUT + 1000);

    return () => {
      clearTimeout(overlayTimeout);
      if (minimapTimeout.current) clearTimeout(minimapTimeout.current);
      if (speedHideTimeout.current) clearTimeout(speedHideTimeout.current);
    };
  }, []);

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
            
            <div ref={heartRateRef}>
              <HeartRateMonitor 
                pulsoidToken={API_KEYS.PULSOID} 
                onVisibilityChange={() => {}}
              />
            </div>
          </div>
        </div>

        {(isLocationEnabled || settings.showWeather || (settings.showMinimap || settings.minimapSpeedBased)) && (
          <div className="top-right">
            <div className="overlay-container">
              {settings.locationDisplay && settings.locationDisplay !== 'hidden' && (
                <div 
                  className="location" 
                  style={{ 
                    display: (location && location.label && location.countryCode) ? 'flex' : 'none'
                  }}
                >
                  {location && location.label && (
                    <>
                      {location.label}
                      {location.countryCode && (
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

            {shouldShowMinimap() && (
              <div className="minimap" style={{ opacity: minimapOpacity, transition: 'opacity 0.5s ease-in-out' }}>
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
           channelName={safeSettings.kickChannelName}
           dailyGoal={safeSettings.kickDailySubGoal}
           isVisible={safeSettings.showKickSubGoal}
           showLatestSub={safeSettings.showLatestSub}
           showLeaderboard={safeSettings.showSubLeaderboard}
           enableRollingSubGoal={safeSettings.enableRollingSubGoal}
           rollingSubGoalIncrement={safeSettings.rollingSubGoalIncrement}
           subGoalData={subGoalData}
           onGoalReset={() => {}}
         />
      </div>
    </ErrorBoundary>
  );
}


