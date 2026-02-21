'use client';

import { useState, useEffect, useRef } from 'react';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { createSettingsHash } from '@/utils/overlay-helpers';
import { NO_CACHE_FETCH_OPTIONS } from '@/utils/overlay-constants';
import { OverlayLogger } from '@/lib/logger';
import type { OverlaySettings } from '@/types/settings';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { TIMERS } from '@/utils/overlay-constants';

/**
 * Loads overlay settings, sets up SSE for real-time updates, and polls as fallback.
 * Returns [settings, setSettings, settingsLoadedRef, refreshSettings] - refreshSettings triggers a one-time fetch.
 */
export function useOverlaySettings(): [
  OverlaySettings,
  React.Dispatch<React.SetStateAction<OverlaySettings>>,
  React.MutableRefObject<boolean>,
  () => Promise<void>
] {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const lastSettingsHash = useRef<string>('');
  const settingsLoadedRef = useRef(false);
  const lastSseUpdateRef = useRef<number>(0);
  const loadSettingsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, NO_CACHE_FETCH_OPTIONS);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data) {
          const merged = mergeSettingsWithDefaults(data);
          setSettings(merged);
          lastSettingsHash.current = createSettingsHash(merged);
          settingsLoadedRef.current = true;
        }
      } catch (error) {
        OverlayLogger.warn('Settings load failed, keeping existing settings', { error });
      }
    };

    const setupSSE = () => {
      const eventSource = new EventSource('/api/settings-stream');
      eventSource.onopen = () => {
        if (process.env.NODE_ENV === 'development') {
          OverlayLogger.settings('SSE connected — updates will appear rapidly when admin saves');
        }
      };
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          lastSseUpdateRef.current = Date.now(); // any message = connection alive (heartbeat, connected, settings_update)
          if (data.type === 'settings_update') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type/timestamp excluded from settingsData
            const { type: _t, timestamp: _ts, ...settingsData } = data;
            const merged = mergeSettingsWithDefaults(settingsData);
            OverlayLogger.settings('Settings updated via SSE', { locationDisplay: merged.locationDisplay, showWeather: merged.showWeather, showMinimap: merged.showMinimap });
            setSettings(merged);
            lastSettingsHash.current = createSettingsHash(merged);
            settingsLoadedRef.current = true;
          }
        } catch {
          /* ignore malformed */
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) return;
        if (process.env.NODE_ENV === 'development') {
          OverlayLogger.warn('SSE connection error — reconnecting in 1s, polling will be used as fallback');
        }
        try { eventSource.close(); } catch { /* ignore */ }
        setTimeout(() => { try { setupSSE(); } catch { /* ignore */ } }, 1000);
      };
      return eventSource;
    };

    // Delay SSE until page has loaded to reduce "connection interrupted while loading" during nav/refresh
    let eventSource: EventSource | null = null;
    let sseDelayId: ReturnType<typeof setTimeout> | null = null;
    const startSSE = () => {
      sseDelayId = setTimeout(() => { eventSource = setupSSE(); }, 500);
    };
    loadSettingsRef.current = loadSettings;
    loadSettings().then(() => {
      if (document.readyState === 'complete') startSSE();
      else window.addEventListener('load', startSSE, { once: true });
    }).catch(() => {
      sseDelayId = setTimeout(() => { eventSource = setupSSE(); }, 2000);
    });

    const pollInterval = 5000; // 5s for settings
    const poll = setInterval(async () => {
      try {
        // Skip poll if SSE updated recently (saves KV reads)
        if (Date.now() - lastSseUpdateRef.current < 15000) return;
        if (process.env.NODE_ENV === 'development' && lastSseUpdateRef.current > 0) {
          OverlayLogger.settings('Polling fallback — SSE has not updated in 15s, fetching settings');
        }
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, NO_CACHE_FETCH_OPTIONS);
        if (res.ok) {
          const data = await res.json();
          if (data && createSettingsHash(data) !== lastSettingsHash.current) {
            lastSettingsHash.current = createSettingsHash(data);
            setSettings(data);
          } else if (data && (data.leaderboardTop || data.overlayAlerts)) {
            setSettings((prev) => ({
              ...prev,
              leaderboardTop: Array.isArray(data.leaderboardTop) && data.leaderboardTop.length > 0 ? data.leaderboardTop : (prev.leaderboardTop ?? []),
              overlayAlerts: data.overlayAlerts ?? prev.overlayAlerts,
            }));
          }
        }
      } catch (error) {
        OverlayLogger.warn('Settings polling failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, pollInterval);

    // Fast poll for alerts (never skipped) — alerts expire in 15s, so we need frequent fetches
    const fastPollInterval = 2000; // 2s
    const fastPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, NO_CACHE_FETCH_OPTIONS);
        if (!res.ok) return;
        const data = await res.json();
        if (!data) return;
        // Only update leaderboard + alerts (lightweight update, no hash check)
        // Preserve previous leaderboard when fetch returns empty to avoid flash
        setSettings((prev) => ({
          ...prev,
          leaderboardTop: Array.isArray(data.leaderboardTop) && data.leaderboardTop.length > 0 ? data.leaderboardTop : (prev.leaderboardTop ?? []),
          overlayAlerts: data.overlayAlerts ?? prev.overlayAlerts,
        }));
      } catch {
        /* ignore */
      }
    }, fastPollInterval);

    return () => {
      window.removeEventListener('load', startSSE);
      if (sseDelayId) clearTimeout(sseDelayId);
      if (eventSource) eventSource.close();
      clearInterval(poll);
      clearInterval(fastPoll);
    };
  }, []);

  // Vote updates during active poll — adaptive: 6s normally, 3s in final 20s for smoother finish
  useEffect(() => {
    if (settings.pollState?.status !== 'active') return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/get-poll-state?_t=${Date.now()}`, NO_CACHE_FETCH_OPTIONS);
        if (res.ok) {
          const { pollState } = await res.json();
          if (pollState?.status === 'active') {
            setSettings((prev) => ({ ...prev, pollState }));
            const elapsed = (Date.now() - pollState.startedAt) / 1000;
            const remaining = pollState.durationSeconds - elapsed;
            const delay =
              remaining <= TIMERS.POLL_VOTE_UPDATE_FAST_SECONDS
                ? TIMERS.POLL_VOTE_UPDATE_INTERVAL_FAST
                : TIMERS.POLL_VOTE_UPDATE_INTERVAL;
            timeoutId = setTimeout(poll, delay);
          }
        } else {
          timeoutId = setTimeout(poll, TIMERS.POLL_VOTE_UPDATE_INTERVAL);
        }
      } catch {
        timeoutId = setTimeout(poll, TIMERS.POLL_VOTE_UPDATE_INTERVAL);
      }
    };
    timeoutId = setTimeout(poll, TIMERS.POLL_VOTE_UPDATE_INTERVAL);
    return () => clearTimeout(timeoutId);
  }, [settings.pollState?.status, setSettings]);

  const refreshSettings = async () => {
    await loadSettingsRef.current();
  };

  return [settings, setSettings, settingsLoadedRef, refreshSettings];
}
