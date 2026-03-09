"use client";

import { useState, useRef, useCallback } from 'react';
import type { SunriseSunsetData } from '@/utils/api-utils';
import { OverlayLogger } from '@/lib/logger';
import { isNightTimeFallback } from '@/utils/fallback-utils';

/**
 * Manages weather state: temperature, description, sunrise/sunset, and timezone.
 * The actual fetch is triggered from the RTIRL listener in the parent — this hook
 * provides state, setters, and the in-progress guard ref that the RTIRL closure reads.
 */
export function useWeatherData() {
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [sunriseSunset, setSunriseSunset] = useState<SunriseSunsetData | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);

  /** Guards against concurrent fetches — read/write directly from the RTIRL closure. */
  const weatherFetchInProgress = useRef(false);
  /** Last time a weather fetch was started (for rate-gating). */
  const lastWeatherTime = useRef(0);
  /** Last time weather was successfully received (for backoff logic). */
  const lastSuccessfulWeatherFetch = useRef(0);

  const updateWeather = useCallback((weatherData: { temp: number; desc: string }) => {
    setWeather(weatherData);
    lastSuccessfulWeatherFetch.current = Date.now();
  }, []);

  /**
   * Updates timezone only when the value is a valid IANA timezone string.
   * Multiple sources write here (RTIRL < OpenWeatherMap < LocationIQ priority);
   * the caller is responsible for priority ordering.
   */
  const updateTimezone = useCallback((timezoneData: string) => {
    if (!timezoneData) return;
    // Basic sanity check — full validation via isValidTimezone happens in parent
    setTimezone(timezoneData);
  }, []);

  /**
   * Computes whether it is currently night-time at the stream location.
   * Called during render (not a hook itself) so can be used in useMemo.
   */
  const computeIsNightTime = useCallback(
    (staleCheckTime: number): boolean => {
      void staleCheckTime; // dependency consumed by caller's useMemo
      if (!sunriseSunset) {
        if (!timezone) return false;
        return isNightTimeFallback(timezone);
      }
      try {
        const now = new Date();
        const sunriseUTC = new Date(sunriseSunset.sunrise);
        const sunsetUTC = new Date(sunriseSunset.sunset);
        const tz = timezone || 'UTC';
        const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
        const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
        const sunriseHour = parseInt(sunriseUTC.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
        const sunriseMin = parseInt(sunriseUTC.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
        const sunsetHour = parseInt(sunsetUTC.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
        const sunsetMin = parseInt(sunsetUTC.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));
        const currentMinutes = currentHour * 60 + currentMinute;
        const sunriseMinutes = sunriseHour * 60 + sunriseMin;
        const sunsetMinutes = sunsetHour * 60 + sunsetMin;
        return currentMinutes < sunriseMinutes || currentMinutes > sunsetMinutes;
      } catch (error) {
        OverlayLogger.error('Day/night calculation error', error);
        return false;
      }
    },
    [sunriseSunset, timezone]
  );

  return {
    weather,
    sunriseSunset,
    timezone,
    setTimezone,
    setSunriseSunset,
    weatherFetchInProgress,
    lastWeatherTime,
    lastSuccessfulWeatherFetch,
    updateWeather,
    updateTimezone,
    computeIsNightTime,
  };
}
