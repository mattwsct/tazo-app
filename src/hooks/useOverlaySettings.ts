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

    // Single adaptive polling loop — replaces the old separate 2s fast-poll + 5s slow-poll.
    // Base interval: 2s (needed for alert expiry). On consecutive network failures the interval
    // backs off exponentially up to 30s, then resets to 2s on the first successful response.
    // The poll is skipped entirely when SSE has been healthy within the last 15s.
    const POLL_BASE_MS = 2000;
    const POLL_MAX_MS = 30000;
    let pollFailures = 0;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedulePoll = (delayMs: number) => {
      pollTimeoutId = setTimeout(runPoll, delayMs);
    };

    const applySettingsData = (data: Record<string, unknown>, replace: boolean) => {
      const merged = mergeSettingsWithDefaults(data as Partial<OverlaySettings>);
      // Always preserve runtime leaderboard/alert/goal fields from the fetch
      const patch = {
        gamblingLeaderboardTop: Array.isArray(data.gamblingLeaderboardTop) && (data.gamblingLeaderboardTop as unknown[]).length > 0 ? data.gamblingLeaderboardTop as OverlaySettings['gamblingLeaderboardTop'] : undefined,
        earnedLeaderboardWeekly: data.earnedLeaderboardWeekly as OverlaySettings['earnedLeaderboardWeekly'] | undefined,
        earnedLeaderboardMonthly: data.earnedLeaderboardMonthly as OverlaySettings['earnedLeaderboardMonthly'] | undefined,
        earnedLeaderboardLifetime: data.earnedLeaderboardLifetime as OverlaySettings['earnedLeaderboardLifetime'] | undefined,
        overlayAlerts: data.overlayAlerts as OverlaySettings['overlayAlerts'] | undefined,
        streamGoals: data.streamGoals as OverlaySettings['streamGoals'] | undefined,
        subGoalCelebrationUntil: 'subGoalCelebrationUntil' in data ? data.subGoalCelebrationUntil as number | undefined : undefined,
        kicksGoalCelebrationUntil: 'kicksGoalCelebrationUntil' in data ? data.kicksGoalCelebrationUntil as number | undefined : undefined,
      };
      setSettings((prev) => {
        const base: OverlaySettings = replace ? merged : { ...prev, ...merged };
        return {
          ...base,
          gamblingLeaderboardTop: patch.gamblingLeaderboardTop ?? prev.gamblingLeaderboardTop ?? [],
          earnedLeaderboardWeekly: patch.earnedLeaderboardWeekly ?? prev.earnedLeaderboardWeekly,
          earnedLeaderboardMonthly: patch.earnedLeaderboardMonthly ?? prev.earnedLeaderboardMonthly,
          earnedLeaderboardLifetime: patch.earnedLeaderboardLifetime ?? prev.earnedLeaderboardLifetime,
          overlayAlerts: patch.overlayAlerts ?? prev.overlayAlerts,
          streamGoals: patch.streamGoals ?? prev.streamGoals,
          subGoalCelebrationUntil: ('subGoalCelebrationUntil' in data) ? patch.subGoalCelebrationUntil : prev.subGoalCelebrationUntil,
          kicksGoalCelebrationUntil: ('kicksGoalCelebrationUntil' in data) ? patch.kicksGoalCelebrationUntil : prev.kicksGoalCelebrationUntil,
        };
      });
    };

    const runPoll = async () => {
      const sseFresh = Date.now() - lastSseUpdateRef.current < 15000;
      if (sseFresh) {
        // SSE is alive — no need to poll, come back in 2s to check alerts if SSE goes stale
        schedulePoll(POLL_BASE_MS);
        return;
      }
      if (process.env.NODE_ENV === 'development' && lastSseUpdateRef.current > 0) {
        OverlayLogger.settings('Polling fallback — SSE has not updated in 15s, fetching settings');
      }
      try {
        const res = await fetch(`/api/get-settings?_t=${Date.now()}`, NO_CACHE_FETCH_OPTIONS);
        if (res.ok) {
          const data = await res.json() as Record<string, unknown> | null;
          if (data) {
            const hash = createSettingsHash(mergeSettingsWithDefaults(data as Partial<OverlaySettings>));
            applySettingsData(data, hash !== lastSettingsHash.current);
            if (hash !== lastSettingsHash.current) lastSettingsHash.current = hash;
            settingsLoadedRef.current = true;
          }
          // Success — reset backoff
          pollFailures = 0;
          schedulePoll(POLL_BASE_MS);
        } else {
          schedulePoll(POLL_BASE_MS);
        }
      } catch (error) {
        pollFailures++;
        // Back off exponentially: 2s → 4s → 8s → 16s → 30s cap
        const backoff = Math.min(POLL_BASE_MS * Math.pow(2, pollFailures - 1), POLL_MAX_MS);
        if (process.env.NODE_ENV === 'development') {
          OverlayLogger.warn('Settings polling failed', { error: error instanceof Error ? error.message : String(error), backoffMs: backoff });
        }
        schedulePoll(backoff);
      }
    };

    // Start the adaptive poll loop
    schedulePoll(POLL_BASE_MS);

    return () => {
      window.removeEventListener('load', startSSE);
      if (sseDelayId) clearTimeout(sseDelayId);
      if (sseReconnectId) clearTimeout(sseReconnectId);
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
      if (currentEventSource) { try { currentEventSource.close(); } catch { /* ignore */ } }
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
