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

    let sseReconnectId: ReturnType<typeof setTimeout> | null = null;
    let currentEventSource: EventSource | null = null;

    const setupSSE = () => {
      // Cancel any pending reconnect before creating a new connection
      if (sseReconnectId) { clearTimeout(sseReconnectId); sseReconnectId = null; }
      if (currentEventSource) { try { currentEventSource.close(); } catch { /* ignore */ } }

      const eventSource = new EventSource('/api/settings-stream');
      currentEventSource = eventSource;

      eventSource.onopen = () => {
        if (process.env.NODE_ENV === 'development') {
          OverlayLogger.settings('SSE connected — updates will appear rapidly when admin saves');
        }
      };
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          lastSseUpdateRef.current = Date.now();
          if (data.type === 'settings_update') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type/timestamp excluded from settingsData
            const { type: _t, timestamp: _ts, ...settingsData } = data;
            const merged = mergeSettingsWithDefaults(settingsData);
            OverlayLogger.settings('Settings updated via SSE', { locationDisplay: merged.locationDisplay, showWeather: merged.showWeather, showMinimap: merged.showMinimap });
            setSettings((prev) => ({
              ...merged,
              gamblingLeaderboardTop: Array.isArray(merged.gamblingLeaderboardTop) && merged.gamblingLeaderboardTop.length > 0 ? merged.gamblingLeaderboardTop : (prev.gamblingLeaderboardTop ?? []),
              earnedLeaderboardWeekly: merged.earnedLeaderboardWeekly ?? prev.earnedLeaderboardWeekly,
              earnedLeaderboardMonthly: merged.earnedLeaderboardMonthly ?? prev.earnedLeaderboardMonthly,
              earnedLeaderboardLifetime: merged.earnedLeaderboardLifetime ?? prev.earnedLeaderboardLifetime,
              overlayAlerts: merged.overlayAlerts ?? prev.overlayAlerts,
              streamGoals: merged.streamGoals ?? prev.streamGoals,
              subGoalCelebrationUntil: 'subGoalCelebrationUntil' in data ? data.subGoalCelebrationUntil : prev.subGoalCelebrationUntil,
              kicksGoalCelebrationUntil: 'kicksGoalCelebrationUntil' in data ? data.kicksGoalCelebrationUntil : prev.kicksGoalCelebrationUntil,
            }));
            lastSettingsHash.current = createSettingsHash(merged);
            settingsLoadedRef.current = true;
          }
        } catch {
          /* ignore malformed */
        }
      };
      eventSource.onerror = () => {
        // Always close and schedule a reconnect — regardless of readyState.
        // The CLOSED guard was the original bug: if the server returned an error or the
        // connection was terminated before our first heartbeat, readyState would be CLOSED
        // and the old guard would return early, leaving the client permanently in polling fallback.
        try { eventSource.close(); } catch { /* ignore */ }
        if (currentEventSource !== eventSource) return; // already superseded
        currentEventSource = null;
        if (sseReconnectId) return; // reconnect already scheduled
        sseReconnectId = setTimeout(() => {
          sseReconnectId = null;
          setupSSE();
        }, 2000);
      };
    };

    // Delay SSE until page has loaded to reduce "connection interrupted while loading" during nav/refresh
    let sseDelayId: ReturnType<typeof setTimeout> | null = null;
    const startSSE = () => {
      sseDelayId = setTimeout(() => setupSSE(), 500);
    };
    loadSettingsRef.current = loadSettings;
    loadSettings().then(() => {
      if (document.readyState === 'complete') startSSE();
      else window.addEventListener('load', startSSE, { once: true });
    }).catch(() => {
      sseDelayId = setTimeout(() => setupSSE(), 2000);
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
            setSettings((prev) => ({
              ...data,
              gamblingLeaderboardTop: Array.isArray(data.gamblingLeaderboardTop) && data.gamblingLeaderboardTop.length > 0 ? data.gamblingLeaderboardTop : (prev.gamblingLeaderboardTop ?? []),
              earnedLeaderboardWeekly: data.earnedLeaderboardWeekly ?? prev.earnedLeaderboardWeekly,
              earnedLeaderboardMonthly: data.earnedLeaderboardMonthly ?? prev.earnedLeaderboardMonthly,
              earnedLeaderboardLifetime: data.earnedLeaderboardLifetime ?? prev.earnedLeaderboardLifetime,
              overlayAlerts: data.overlayAlerts ?? prev.overlayAlerts,
            }));
          } else if (data) {
            setSettings((prev) => ({
              ...prev,
              gamblingLeaderboardTop: Array.isArray(data.gamblingLeaderboardTop) && data.gamblingLeaderboardTop.length > 0 ? data.gamblingLeaderboardTop : (prev.gamblingLeaderboardTop ?? []),
              earnedLeaderboardWeekly: data.earnedLeaderboardWeekly ?? prev.earnedLeaderboardWeekly,
              earnedLeaderboardMonthly: data.earnedLeaderboardMonthly ?? prev.earnedLeaderboardMonthly,
              earnedLeaderboardLifetime: data.earnedLeaderboardLifetime ?? prev.earnedLeaderboardLifetime,
              overlayAlerts: data.overlayAlerts ?? prev.overlayAlerts,
              streamGoals: data.streamGoals ?? prev.streamGoals,
              subGoalCelebrationUntil: 'subGoalCelebrationUntil' in data ? data.subGoalCelebrationUntil : prev.subGoalCelebrationUntil,
              kicksGoalCelebrationUntil: 'kicksGoalCelebrationUntil' in data ? data.kicksGoalCelebrationUntil : prev.kicksGoalCelebrationUntil,
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
        // Preserve previous leaderboard when fetch returns empty to avoid flash
        setSettings((prev) => ({
          ...prev,
          gamblingLeaderboardTop: Array.isArray(data.gamblingLeaderboardTop) && data.gamblingLeaderboardTop.length > 0 ? data.gamblingLeaderboardTop : (prev.gamblingLeaderboardTop ?? []),
          earnedLeaderboardWeekly: data.earnedLeaderboardWeekly ?? prev.earnedLeaderboardWeekly,
          earnedLeaderboardMonthly: data.earnedLeaderboardMonthly ?? prev.earnedLeaderboardMonthly,
          earnedLeaderboardLifetime: data.earnedLeaderboardLifetime ?? prev.earnedLeaderboardLifetime,
          overlayAlerts: data.overlayAlerts ?? prev.overlayAlerts,
          streamGoals: data.streamGoals ?? prev.streamGoals,
          subGoalCelebrationUntil: 'subGoalCelebrationUntil' in data ? data.subGoalCelebrationUntil : prev.subGoalCelebrationUntil,
          kicksGoalCelebrationUntil: 'kicksGoalCelebrationUntil' in data ? data.kicksGoalCelebrationUntil : prev.kicksGoalCelebrationUntil,
        }));
      } catch {
        /* ignore */
      }
    }, fastPollInterval);

    return () => {
      window.removeEventListener('load', startSSE);
      if (sseDelayId) clearTimeout(sseDelayId);
      if (sseReconnectId) clearTimeout(sseReconnectId);
      if (currentEventSource) { try { currentEventSource.close(); } catch { /* ignore */ } }
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
