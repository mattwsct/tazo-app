'use client';

import { useState, useEffect, useRef } from 'react';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { createSettingsHash } from '@/utils/overlay-helpers';
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
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        });
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
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'settings_update') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type/timestamp excluded from settingsData
            const { type: _t, timestamp: _ts, ...settingsData } = data;
            const merged = mergeSettingsWithDefaults(settingsData);
            lastSseUpdateRef.current = Date.now();
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
        try { eventSource.close(); } catch { /* ignore */ }
        setTimeout(() => { try { setupSSE(); } catch { /* ignore */ } }, 1000);
      };
      return eventSource;
    };

    // Delay SSE until page has loaded to reduce "connection interrupted while loading" during nav/refresh
    let eventSource: EventSource | null = null;
    let sseDelayId: ReturnType<typeof setTimeout> | null = null;
    const startSSE = () => {
      sseDelayId = setTimeout(() => { eventSource = setupSSE(); }, 300);
    };
    loadSettingsRef.current = loadSettings;
    loadSettings().then(() => {
      if (document.readyState === 'complete') startSSE();
      else window.addEventListener('load', startSSE, { once: true });
    }).catch(() => {
      sseDelayId = setTimeout(() => { eventSource = setupSSE(); }, 2000);
    });

    const poll = setInterval(async () => {
      try {
        // Skip poll if SSE updated recently (saves KV reads)
        if (Date.now() - lastSseUpdateRef.current < 20000) return;
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
        if (res.ok) {
          const data = await res.json();
          if (data && createSettingsHash(data) !== lastSettingsHash.current) {
            lastSettingsHash.current = createSettingsHash(data);
            setSettings(data);
          }
        }
      } catch (error) {
        OverlayLogger.warn('Settings polling failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, TIMERS.SETTINGS_POLLING_INTERVAL);

    return () => {
      window.removeEventListener('load', startSSE);
      if (sseDelayId) clearTimeout(sseDelayId);
      if (eventSource) eventSource.close();
      clearInterval(poll);
    };
  }, []);

  // Lightweight vote updates during active poll (1 KV read every 5s vs get-settings 2 reads)
  useEffect(() => {
    if (settings.pollState?.status !== 'active') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/get-poll-state?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });
        if (res.ok) {
          const { pollState } = await res.json();
          if (pollState?.status === 'active') {
            setSettings((prev) => ({ ...prev, pollState }));
          }
        }
      } catch {
        /* ignore */
      }
    }, TIMERS.POLL_VOTE_UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [settings.pollState?.status, setSettings]);

  const refreshSettings = async () => {
    await loadSettingsRef.current();
  };

  return [settings, setSettings, settingsLoadedRef, refreshSettings];
}
