"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import type { OverlaySettings } from '@/types/settings';
import { OverlayLogger } from '@/lib/logger';
import { clearTimer } from '@/utils/overlay-helpers';
import { TIMERS } from '@/utils/overlay-constants';

const {
  WALKING_PACE_THRESHOLD,
  MINIMAP_STALENESS_CHECK_INTERVAL,
  MINIMAP_HIDE_DELAY,
  MINIMAP_SPEED_MIN_READINGS,
  MINIMAP_SPEED_MIN_DURATION_MS,
} = TIMERS;

interface UseMinimapVisibilityOptions {
  /** Refs from useMovementData (read inside callbacks, no dep-array entries needed). */
  lastGpsUpdateTime: React.MutableRefObject<number>;
  speedReadingsRef: React.MutableRefObject<{ speed: number; ts: number }[]>;
  /** Live speed value from state (drives show/hide decisions). */
  currentSpeed: number;
  settings: OverlaySettings;
}

/**
 * Encapsulates minimap show/hide logic:
 * - Manual mode: show/hide follows settings.showMinimap immediately.
 * - Speed-based mode: requires N consecutive RTIRL readings all ≥ 10 km/h
 *   spanning ≥ MINIMAP_SPEED_MIN_DURATION_MS to prevent GPS spikes from
 *   momentarily revealing the minimap.
 * - GPS stale (>1 min without updates): always hide.
 *
 * Returns state + the `updateMinimapVisibility` callback so the RTIRL
 * listener can call it after each GPS update.
 */
export function useMinimapVisibility({
  lastGpsUpdateTime,
  speedReadingsRef,
  currentSpeed,
  settings,
}: UseMinimapVisibilityOptions) {
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [minimapOpacity, setMinimapOpacity] = useState(1.0);

  const minimapFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lowSpeedStartTimeRef = useRef<number | null>(null);
  const sustainedSpeedVisibleRef = useRef(false);

  const updateMinimapVisibility = useCallback(() => {
    // Hidden location mode → never show minimap
    if (settings.locationDisplay === 'hidden') {
      speedReadingsRef.current = [];
      lowSpeedStartTimeRef.current = null;
      sustainedSpeedVisibleRef.current = false;
      setMinimapVisible((vis) => {
        if (vis) {
          setMinimapOpacity(0);
          return false;
        }
        return vis;
      });
      return;
    }

    const now = Date.now();
    const timeSinceLastGps =
      lastGpsUpdateTime.current > 0 ? now - lastGpsUpdateTime.current : Infinity;
    const isGpsStale = timeSinceLastGps > MINIMAP_HIDE_DELAY;

    clearTimer(minimapFadeTimeoutRef);

    const speed = currentSpeed;

    if (settings.minimapSpeedBased) {
      if (isGpsStale) {
        setMinimapVisible((vis) => {
          if (vis) setMinimapOpacity(0);
          return false;
        });
        sustainedSpeedVisibleRef.current = false;
        speedReadingsRef.current = [];
        lowSpeedStartTimeRef.current = null;
        return;
      }

      const readings = speedReadingsRef.current;
      const allAboveThreshold =
        readings.length >= MINIMAP_SPEED_MIN_READINGS &&
        readings.every((r) => r.speed >= WALKING_PACE_THRESHOLD);
      const durationMs =
        readings.length >= 2 ? readings[readings.length - 1].ts - readings[0].ts : 0;
      const hasSustainedHighSpeed = allAboveThreshold && durationMs >= MINIMAP_SPEED_MIN_DURATION_MS;

      if (speed >= WALKING_PACE_THRESHOLD) {
        if (hasSustainedHighSpeed) {
          lowSpeedStartTimeRef.current = null;
          sustainedSpeedVisibleRef.current = true;
          setMinimapVisible(() => {
            setMinimapOpacity(1.0);
            return true;
          });
        }
      } else {
        sustainedSpeedVisibleRef.current = false;
        setMinimapVisible((visible) => {
          if (!visible) {
            speedReadingsRef.current = [];
            lowSpeedStartTimeRef.current = null;
            return visible;
          }
          if (lowSpeedStartTimeRef.current === null) {
            lowSpeedStartTimeRef.current = now;
          }
          const timeSinceLowSpeed = now - lowSpeedStartTimeRef.current;
          if (timeSinceLowSpeed >= MINIMAP_HIDE_DELAY) {
            setMinimapOpacity(0);
            speedReadingsRef.current = [];
            lowSpeedStartTimeRef.current = null;
            return false;
          }
          return visible;
        });
      }
    } else if (settings.showMinimap) {
      lowSpeedStartTimeRef.current = null;
      setMinimapVisible((visible) => {
        if (!visible) {
          setMinimapOpacity(0);
          requestAnimationFrame(() => setMinimapOpacity(1.0));
          return true;
        }
        setMinimapOpacity(1.0);
        return visible;
      });
    } else {
      sustainedSpeedVisibleRef.current = false;
      speedReadingsRef.current = [];
      lowSpeedStartTimeRef.current = null;
      setMinimapVisible((visible) => {
        if (visible) {
          setMinimapOpacity(0);
          clearTimer(minimapFadeTimeoutRef);
          return false;
        }
        return visible;
      });
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, settings.locationDisplay, currentSpeed, lastGpsUpdateTime, speedReadingsRef]);

  // React to settings / speed changes
  useEffect(() => {
    try {
      if (!settings.minimapSpeedBased) {
        sustainedSpeedVisibleRef.current = false;
        speedReadingsRef.current = [];
        lowSpeedStartTimeRef.current = null;
      }
      // Schedule visibility update after paint to avoid cascading renders warning.
      queueMicrotask(() => {
        try {
          updateMinimapVisibility();
        } catch (error) {
          OverlayLogger.error('Failed to update minimap visibility', error);
        }
      });
    } catch (error) {
      OverlayLogger.error('Failed to schedule minimap visibility update', error);
    }
  }, [settings.showMinimap, settings.minimapSpeedBased, currentSpeed, updateMinimapVisibility, speedReadingsRef]);

  // Periodic GPS staleness check (speed-based mode only)
  useEffect(() => {
    if (!settings.minimapSpeedBased) return;

    const interval = setInterval(() => {
      try {
        updateMinimapVisibility();
      } catch (error) {
        OverlayLogger.error('Failed to update minimap visibility in staleness check', error);
      }
    }, MINIMAP_STALENESS_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [settings.minimapSpeedBased, updateMinimapVisibility]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer(minimapFadeTimeoutRef);
    };
  }, []);

  return {
    minimapVisible,
    minimapOpacity,
    sustainedSpeedVisibleRef,
    updateMinimapVisibility,
  };
}
