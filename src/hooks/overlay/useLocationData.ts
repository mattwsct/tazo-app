"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import type { LocationData } from '@/utils/location-utils';
import { OverlayLogger } from '@/lib/logger';

export interface LocationDisplay {
  primary: string;
  secondary?: string;
  countryCode?: string;
}

/**
 * Manages location display state and the associated refs/guards used by the RTIRL
 * listener.  The actual reverse-geocode fetch lives in the RTIRL closure in the
 * parent — this hook provides state, setters, and the refs that closure reads.
 *
 * Also owns:
 *  - The 15-second persistent-fallback timer (loads last-known location from KV
 *    when RTIRL hasn't delivered data yet).
 *  - The 90-second periodic check for browser-set location (admin "Get from browser"
 *    flow stores a newer timestamp in KV).
 */
export function useLocationData(updateTimezone: (tz: string) => void) {
  const [location, setLocation] = useState<LocationDisplay | null>(null);

  /** Full reverse-geocode response — used to re-format when locationDisplay mode changes. */
  const lastRawLocation = useRef<LocationData | null>(null);
  /** Prevents the persistent fallback from overwriting live RTIRL data. */
  const locationReceivedFromRtirlRef = useRef(false);
  /** updatedAt of the currently-displayed location source (RTIRL or persistent KV). */
  const lastLocationSourceTimestampRef = useRef(0);
  /** Cleared as soon as RTIRL delivers the first coordinate update. */
  const persistentFallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Last time a LocationIQ request was started. */
  const lastLocationTime = useRef(0);
  /** Last time a LocationIQ request succeeded. */
  const lastSuccessfulLocationFetch = useRef(0);
  /** Guards against concurrent LocationIQ fetches. */
  const locationFetchInProgress = useRef(false);

  const updateLocation = useCallback((locationData: LocationDisplay) => {
    setLocation(locationData);
    lastSuccessfulLocationFetch.current = Date.now();
  }, []);

  // ── Persistent fallback timer ────────────────────────────────────────────────
  // If RTIRL doesn't send data within 15 s, load the last-known location from KV.
  useEffect(() => {
    const PERSISTENT_FALLBACK_DELAY = 15000;

    const loadFromPersistentFallback = async () => {
      if (locationReceivedFromRtirlRef.current) {
        OverlayLogger.location('Skipping persistent fallback - already have RTIRL data');
        return;
      }
      try {
        OverlayLogger.location('Loading from persistent storage (RTIRL fallback)', { reason: 'no RTIRL data received' });
        const res = await fetch('/api/location', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.location && data.rawLocation) {
            if (locationReceivedFromRtirlRef.current) return;
            setLocation(data.location);
            lastRawLocation.current = data.rawLocation;
            lastLocationSourceTimestampRef.current =
              typeof data.updatedAt === 'number' && data.updatedAt > 0 ? data.updatedAt : 0;
            if (process.env.NODE_ENV !== 'production') {
              OverlayLogger.location('Location from persistent storage (RTIRL unavailable)', {
                primary: data.location.primary || 'none',
                secondary: data.location.secondary || 'none',
              });
            }
          } else {
            OverlayLogger.location('Persistent storage empty - waiting for RTIRL');
          }
        } else {
          OverlayLogger.warn('Persistent location fetch failed', { status: res.status });
        }
      } catch (error) {
        OverlayLogger.warn('Failed to load from persistent storage', { error });
      }
    };

    persistentFallbackTimerRef.current = setTimeout(loadFromPersistentFallback, PERSISTENT_FALLBACK_DELAY);
    OverlayLogger.location('Waiting for RTIRL data', {
      fallbackIn: `${PERSISTENT_FALLBACK_DELAY / 1000}s if no data`,
    });

    return () => {
      if (persistentFallbackTimerRef.current) {
        clearTimeout(persistentFallbackTimerRef.current);
        persistentFallbackTimerRef.current = null;
      }
    };
  }, []);

  // ── Periodic KV check (browser-set location) ────────────────────────────────
  // Every 90 s check whether the admin has saved a newer location via "Get from browser".
  useEffect(() => {
    const PERSISTENT_CHECK_INTERVAL = 90000;

    const checkPersistent = async () => {
      try {
        const res = await fetch('/api/location', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.location?.primary && !data.rawLocation) return;
        const persistentUpdatedAt = data.updatedAt as number | undefined;
        if (persistentUpdatedAt && persistentUpdatedAt > lastLocationSourceTimestampRef.current) {
          lastLocationSourceTimestampRef.current = persistentUpdatedAt;
          lastRawLocation.current = data.rawLocation ?? lastRawLocation.current;
          setLocation(data.location);
          const storedTz = data.rawLocation?.timezone as string | undefined;
          if (storedTz) updateTimezone(storedTz);
          if (process.env.NODE_ENV !== 'production') {
            OverlayLogger.location('Using persistent (newer than RTIRL)', {
              updatedAt: persistentUpdatedAt,
              timezone: storedTz ?? 'none',
            });
          }
        }
      } catch { /* ignore */ }
    };

    const id = setInterval(checkPersistent, PERSISTENT_CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [updateTimezone]);

  return {
    location,
    setLocation,
    lastRawLocation,
    locationReceivedFromRtirlRef,
    lastLocationSourceTimestampRef,
    persistentFallbackTimerRef,
    lastLocationTime,
    lastSuccessfulLocationFetch,
    locationFetchInProgress,
    updateLocation,
  };
}
