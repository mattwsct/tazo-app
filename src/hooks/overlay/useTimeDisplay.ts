"use client";

import { useState, useEffect, useCallback } from 'react';
import { isValidTimezone } from '@/utils/overlay-helpers';
import { formatTimeWithTimezone } from '@/utils/overlay-helpers';
import { OverlayLogger } from '@/lib/logger';

/**
 * Manages the time/date display state.
 * Polls every 10s so the display stays accurate even when the tab is throttled
 * (a 60s interval can skip a minute when backgrounded in OBS).
 */
export function useTimeDisplay(timezone: string | null) {
  const [timeDisplay, setTimeDisplay] = useState({ time: '', date: '' });

  const formatTime = useCallback((tz: string | null): { time: string; date: string } => {
    if (!isValidTimezone(tz)) {
      return { time: '', date: '' };
    }
    const safeTz = tz as string;
    try {
      return formatTimeWithTimezone(safeTz);
    } catch (error) {
      OverlayLogger.warn('Invalid timezone format, using UTC fallback', { timezone: tz, error });
      return formatTimeWithTimezone('UTC');
    }
  }, []);

  useEffect(() => {
    let lastTime = '';
    let lastDate = '';

    const updateTime = () => {
      const formatted = formatTime(timezone);
      if (formatted.time !== lastTime || formatted.date !== lastDate) {
        lastTime = formatted.time;
        lastDate = formatted.date;
        setTimeDisplay(formatted);
      }
    };

    updateTime();

    const intervalId = setInterval(updateTime, 10000); // every 10 seconds
    return () => clearInterval(intervalId);
  }, [timezone, formatTime]);

  return { timeDisplay, formatTime };
}
