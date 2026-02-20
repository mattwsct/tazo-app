"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, LocationStaleMaxFallback, MapZoomLevel, DisplayMode, TodoItem } from '@/types/settings';
import {
  DEFAULT_KICK_MESSAGES,
  TEMPLATE_GROUP_CONFIG,
  TEMPLATE_GROUP_ICONS,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled, KickMessageTemplateEnabled } from '@/types/kick-messages';
import { formatLocationForStreamTitle, parseStreamTitleToCustom, buildStreamTitle } from '@/utils/stream-title-utils';
import type { StreamTitleLocationDisplay } from '@/utils/stream-title-utils';
import { formatLocation, type LocationData } from '@/utils/location-utils';
import '@/styles/admin.css';

function formatLocationAge(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

const KICK_MESSAGE_LABELS: Record<keyof KickMessageTemplates, string> = {
  follow: 'Follow',
  newSub: 'New sub',
  resub: 'Resub',
  giftSubSingle: 'Gift sub (to one)',
  giftSubMulti: 'Gift sub (multiple)',
  giftSubGeneric: 'Gift sub (generic)',
  kicksGifted: 'Kicks gifted',
  kicksGiftedWithMessage: 'Kicks gifted (with message)',
  channelReward: 'Channel reward',
  channelRewardWithInput: 'Channel reward (with input)',
  channelRewardApproved: 'Channel reward (approved)',
  channelRewardDeclined: 'Channel reward (declined)',
  streamStarted: 'Stream started',
  streamEnded: 'Stream ended',
};


export default function AdminPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [toast, setToast] = useState<{ type: 'saving' | 'saved' | 'error'; message: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'disconnected' | 'syncing'>('disconnected');

  // Custom location input state (for debouncing)
  const [customLocationInput, setCustomLocationInput] = useState('');
  const customLocationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kickMessagesSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kickMessagesRef = useRef<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const kickTemplateEnabledRef = useRef<KickMessageTemplateEnabled>({});

  // Todo editing state
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');

  // Kick bot state
  const [kickStatus, setKickStatus] = useState<{ connected: boolean; subscriptions?: unknown[] } | null>(null);
  const [kickMessages, setKickMessages] = useState<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const [kickMessageEnabled, setKickMessageEnabled] = useState<KickMessageEnabled>(DEFAULT_KICK_MESSAGE_ENABLED);
  const [kickTemplateEnabled, setKickTemplateEnabled] = useState<KickMessageTemplateEnabled>(() => {
    const t: KickMessageTemplateEnabled = {};
    for (const group of TEMPLATE_GROUP_CONFIG) {
      for (const k of group.templateKeys) {
        t[k as keyof KickMessageTemplates] = true;
      }
    }
    return t;
  });
  const [kickMinimumKicks, setKickMinimumKicks] = useState(0);
  const [kickGiftSubShowLifetimeSubs, setKickGiftSubShowLifetimeSubs] = useState(true);
  const [kickChatBroadcastLocation, setKickChatBroadcastLocation] = useState(false);
  const [kickChatBroadcastWeather, setKickChatBroadcastWeather] = useState(false);
  const [kickChatBroadcastHeartrate, setKickChatBroadcastHeartrate] = useState(false);
  const [kickChatBroadcastHeartrateMinBpm, setKickChatBroadcastHeartrateMinBpm] = useState(100);
  const [kickChatBroadcastHeartrateVeryHighBpm, setKickChatBroadcastHeartrateVeryHighBpm] = useState(120);
  const [kickChatBroadcastSpeed, setKickChatBroadcastSpeed] = useState(false);
  const [kickChatBroadcastSpeedMinKmh, setKickChatBroadcastSpeedMinKmh] = useState(20);
  const [kickChatBroadcastAltitude, setKickChatBroadcastAltitude] = useState(false);
  const [kickChatBroadcastAltitudeMinM, setKickChatBroadcastAltitudeMinM] = useState(50);
  const [kickStreamTitleCustom, setKickStreamTitleCustom] = useState('');
  const [kickStreamTitleLocationDisplay, setKickStreamTitleLocationDisplay] = useState<StreamTitleLocationDisplay>('state');
  const [kickStreamTitleAutoUpdate, setKickStreamTitleAutoUpdate] = useState(true);
  const [kickStreamTitleIncludeLocation, setKickStreamTitleIncludeLocation] = useState(true);
  const [kickStreamTitleLocation, setKickStreamTitleLocation] = useState<string>('');
  const [kickStreamTitleRawLocation, setKickStreamTitleRawLocation] = useState<LocationData | null>(null);
  const [storedLocation, setStoredLocation] = useState<{
    primary: string;
    secondary?: string;
    updatedAt?: number;
  } | null>(null);
  const [kickStreamTitleLoading, setKickStreamTitleLoading] = useState(false);
  const [kickStreamTitleSaving, setKickStreamTitleSaving] = useState(false);
  const [kickPollEnabled, setKickPollEnabled] = useState(false);
  const [kickPollDuration, setKickPollDuration] = useState(60);
  const [kickPollEveryoneCanStart, setKickPollEveryoneCanStart] = useState(false);
  const [kickPollModsCanStart, setKickPollModsCanStart] = useState(true);
  const [kickPollVipsCanStart, setKickPollVipsCanStart] = useState(false);
  const [kickPollOgsCanStart, setKickPollOgsCanStart] = useState(false);
  const [kickPollSubsCanStart, setKickPollSubsCanStart] = useState(false);
  const [kickPollMaxQueued, setKickPollMaxQueued] = useState(5);
  const [kickPollAutoStart, setKickPollAutoStart] = useState(false);
  const [kickPollMinutesSinceLastPoll, setKickPollMinutesSinceLastPoll] = useState(5);
  const [kickPollOneVotePerPerson, setKickPollOneVotePerPerson] = useState(false);
  // Single scrollable page — Location/Stream title shared, Overlay and Kick sections follow

  

  // Check authentication status and refresh session
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Add timeout to prevent infinite loading
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const res = await authenticatedFetch('/api/get-settings', {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
          setIsAuthenticated(true);
          
          // Refresh session periodically to prevent expiry
          refreshSession();
        } else if (res.status === 401) {
          router.push('/login');
          return;
        } else {
          // Handle other HTTP errors
          console.error('Authentication check failed with status:', res.status);
          router.push('/login');
          return;
        }
      } catch (error) {
        console.error('Authentication check error:', error);
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('Authentication check timed out');
        }
        router.push('/login');
        return;
      }
    };

    checkAuth();
  }, [router]);

  // Session refresh function
  const refreshSession = async () => {
    try {
      await authenticatedFetch('/api/refresh-session', {
        method: 'POST',
      });
    } catch (error) {
      console.warn('Session refresh error:', error);
    }
  };

  // Periodic session refresh to prevent expiry
  useEffect(() => {
    if (!isAuthenticated) return;

    // Refresh session every 6 hours (before 7-day expiry)
    const refreshInterval = setInterval(refreshSession, 6 * 60 * 60 * 1000); // 6 hours

    return () => clearInterval(refreshInterval);
  }, [isAuthenticated]);

  const loadSettings = useCallback(async () => {
    try {
      setSyncStatus('syncing');
      // Add timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const res = await authenticatedFetch('/api/get-settings', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
          const data = await res.json();
          if (data) {
            setSettings(data);
            setSyncStatus('connected');
          }
    } catch (error) {
      console.error('Failed to load settings:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Settings load timed out');
      }
      setSyncStatus('disconnected');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Kick bot status, OAuth callback, and message loading
  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const oauthResult = params.get('kick_oauth');
    if (oauthResult === 'success') {
      setToast({ type: 'saved', message: 'Saved!' });
      setTimeout(() => setToast(null), 3000);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthResult === 'error') {
      const err = params.get('error') ?? 'Unknown error';
      setToast({ type: 'error', message: `Kick connection failed: ${err}` });
      setTimeout(() => setToast(null), 5000);
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetch('/api/kick-oauth/status', { credentials: 'include' })
      .then((r) => r.json())
      .then(setKickStatus)
      .catch(() => setKickStatus({ connected: false }));
    fetch('/api/kick-messages', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.messages) setKickMessages({ ...DEFAULT_KICK_MESSAGES, ...d.messages });
        if (d.enabled) setKickMessageEnabled({ ...DEFAULT_KICK_MESSAGE_ENABLED, ...d.enabled });
        if (d.templateEnabled) setKickTemplateEnabled((prev) => ({ ...prev, ...d.templateEnabled }));
        if (d.alertSettings?.minimumKicks != null) setKickMinimumKicks(d.alertSettings.minimumKicks);
        if (d.alertSettings?.giftSubShowLifetimeSubs !== undefined) setKickGiftSubShowLifetimeSubs(d.alertSettings.giftSubShowLifetimeSubs);
        if (d.alertSettings?.chatBroadcastLocation !== undefined) setKickChatBroadcastLocation(d.alertSettings.chatBroadcastLocation);
        if (d.alertSettings?.chatBroadcastWeather !== undefined) setKickChatBroadcastWeather(d.alertSettings.chatBroadcastWeather);
        if (d.alertSettings?.chatBroadcastHeartrate !== undefined) setKickChatBroadcastHeartrate(d.alertSettings.chatBroadcastHeartrate);
        if (d.alertSettings?.chatBroadcastHeartrateMinBpm != null) setKickChatBroadcastHeartrateMinBpm(d.alertSettings.chatBroadcastHeartrateMinBpm);
        if (d.alertSettings?.chatBroadcastHeartrateVeryHighBpm != null) setKickChatBroadcastHeartrateVeryHighBpm(d.alertSettings.chatBroadcastHeartrateVeryHighBpm);
        if (d.alertSettings?.chatBroadcastSpeed !== undefined) setKickChatBroadcastSpeed(d.alertSettings.chatBroadcastSpeed);
        if (d.alertSettings?.chatBroadcastSpeedMinKmh != null) setKickChatBroadcastSpeedMinKmh(d.alertSettings.chatBroadcastSpeedMinKmh);
        if (d.alertSettings?.chatBroadcastAltitude !== undefined) setKickChatBroadcastAltitude(d.alertSettings.chatBroadcastAltitude);
        if (d.alertSettings?.chatBroadcastAltitudeMinM != null) setKickChatBroadcastAltitudeMinM(d.alertSettings.chatBroadcastAltitudeMinM);
      })
      .catch(() => {});
    fetch('/api/kick-poll-settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.enabled !== undefined) setKickPollEnabled(d.enabled);
        if (d?.durationSeconds != null) setKickPollDuration(d.durationSeconds);
        if (d?.everyoneCanStart !== undefined) setKickPollEveryoneCanStart(d.everyoneCanStart);
        if (d?.modsCanStart !== undefined) setKickPollModsCanStart(d.modsCanStart);
        if (d?.vipsCanStart !== undefined) setKickPollVipsCanStart(d.vipsCanStart);
        if (d?.ogsCanStart !== undefined) setKickPollOgsCanStart(d.ogsCanStart);
        if (d?.subsCanStart !== undefined) setKickPollSubsCanStart(d.subsCanStart);
        if (d?.maxQueuedPolls != null) setKickPollMaxQueued(d.maxQueuedPolls);
        if (d?.autoStartPollsEnabled !== undefined) setKickPollAutoStart(d.autoStartPollsEnabled);
        if (d?.minutesSinceLastPoll != null) setKickPollMinutesSinceLastPoll(d.minutesSinceLastPoll);
        else if (d?.chatIdleMinutes != null) setKickPollMinutesSinceLastPoll(d.chatIdleMinutes);
        if (d?.oneVotePerPerson !== undefined) setKickPollOneVotePerPerson(d.oneVotePerPerson);
      })
      .catch(() => {});
    fetch('/api/kick-channel', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setKickStreamTitleLocationDisplay((d.settings.locationDisplay as StreamTitleLocationDisplay) ?? 'state');
          setKickStreamTitleAutoUpdate(d.settings.autoUpdateLocation !== false);
        }
        if (d.stream_title != null) {
          if (d.is_live) {
            const parsed = parseStreamTitleToCustom(d.stream_title);
            setKickStreamTitleCustom(parsed || (d.settings?.customTitle ?? ''));
          } else {
            setKickStreamTitleCustom(d.settings?.customTitle ?? d.stream_title ?? '');
          }
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const handleKickTemplateToggleChange = useCallback(
    async (key: keyof KickMessageTemplates, value: boolean) => {
      const next = { ...kickTemplateEnabled, [key]: value };
      setKickTemplateEnabled(next);
      setToast({ type: 'saving', message: 'Saving...' });
      try {
        const r = await authenticatedFetch('/api/kick-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateEnabled: next }),
        });
        if (r.ok) {
          setToast({ type: 'saved', message: 'Saved!' });
        } else {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to save');
        }
      } catch (err) {
        setKickTemplateEnabled((prev) => ({ ...prev, [key]: !value }));
        setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
      setTimeout(() => setToast(null), 3000);
    },
    [kickTemplateEnabled]
  );

  const lastPushedLocationRef = useRef<string | null>(null);
  const kickStreamTitleCustomRef = useRef(kickStreamTitleCustom);
  const kickStreamTitleLocationDisplayRef = useRef(kickStreamTitleLocationDisplay);
  const kickStreamTitleIncludeLocationRef = useRef(kickStreamTitleIncludeLocation);
  kickStreamTitleCustomRef.current = kickStreamTitleCustom;
  kickStreamTitleLocationDisplayRef.current = kickStreamTitleLocationDisplay;
  kickStreamTitleIncludeLocationRef.current = kickStreamTitleIncludeLocation;

  const fetchLocationData = useCallback(async () => {
    try {
      const locRes = await fetch('/api/get-location', { credentials: 'include' });
      const locData = await locRes.json();
      const raw = locData?.rawLocation ?? locData?.location;
      if (raw) {
        setKickStreamTitleRawLocation(raw);
        const display = kickStreamTitleLocationDisplayRef.current;
        setKickStreamTitleLocation(formatLocationForStreamTitle(raw, display));
        if (locData?.location?.primary !== undefined) {
          setStoredLocation({
            primary: locData.location.primary,
            secondary: locData.location.secondary,
            updatedAt: locData.updatedAt,
          });
        }
      } else {
        setKickStreamTitleLocation('');
        setKickStreamTitleRawLocation(null);
        setStoredLocation(null);
      }
    } catch {
      setKickStreamTitleLocation('');
      setKickStreamTitleRawLocation(null);
      setStoredLocation(null);
    }
  }, []);

  const tryAutoPushStreamTitle = useCallback(async () => {
    if (!kickStatus?.connected || !kickStreamTitleAutoUpdate) return;
    try {
      const channelRes = await authenticatedFetch('/api/kick-channel');
      const channelData = await channelRes.json();
      if (!channelData.is_live) return;
      const currentKickTitle = channelData.stream_title ?? '';
      const parsedCustom = parseStreamTitleToCustom(currentKickTitle);
      if (parsedCustom) {
        kickStreamTitleCustomRef.current = parsedCustom;
        setKickStreamTitleCustom(parsedCustom);
      }
      const locRes = await fetch('/api/get-location', { credentials: 'include' });
      const locData = await locRes.json();
      const raw = locData?.rawLocation ?? locData?.location;
      if (!raw) return;
      const display = kickStreamTitleLocationDisplayRef.current;
      const formatted = formatLocationForStreamTitle(raw, display);
      setKickStreamTitleRawLocation(raw);
      setKickStreamTitleLocation(formatted);
      const custom = kickStreamTitleCustomRef.current.trim();
      const includeLocation = kickStreamTitleIncludeLocationRef.current;
      const locationPart = includeLocation ? formatted : '';
      const newFullTitle = buildStreamTitle(custom, locationPart);
      if (newFullTitle === currentKickTitle.trim()) return;
      const r = await authenticatedFetch('/api/kick-channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_title: newFullTitle,
            settings: {
              customTitle: custom,
              locationDisplay: display,
              autoUpdateLocation: true,
              includeLocationInTitle: includeLocation,
            },
        }),
      });
      if (r.ok) {
        lastPushedLocationRef.current = formatted;
        setToast({ type: 'saved', message: 'Saved!' });
        setTimeout(() => setToast(null), 2000);
      }
    } catch {
      // Silently ignore auto-push failures
    }
  }, [kickStatus?.connected, kickStreamTitleAutoUpdate]);

  useEffect(() => {
    fetchLocationData();
  }, [fetchLocationData]);

  useEffect(() => {
    if (!kickStreamTitleAutoUpdate) return;
    const interval = setInterval(tryAutoPushStreamTitle, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [kickStreamTitleAutoUpdate, tryAutoPushStreamTitle]);

  useEffect(() => {
    if (kickStreamTitleRawLocation) {
      setKickStreamTitleLocation(formatLocationForStreamTitle(kickStreamTitleRawLocation, kickStreamTitleLocationDisplay));
    }
  }, [kickStreamTitleLocationDisplay, kickStreamTitleRawLocation]);

  const fetchKickStreamTitle = useCallback(async () => {
    setKickStreamTitleLoading(true);
    try {
      const r = await authenticatedFetch('/api/kick-channel');
      const data = await r.json();
      if (data.settings) {
        setKickStreamTitleLocationDisplay((data.settings.locationDisplay as StreamTitleLocationDisplay) ?? 'state');
        setKickStreamTitleAutoUpdate(data.settings.autoUpdateLocation !== false);
        setKickStreamTitleIncludeLocation((data.settings as { includeLocationInTitle?: boolean }).includeLocationInTitle !== false);
      }
      if (data.stream_title != null) {
        if (data.stream_title === '' && !data.error) {
          setToast({ type: 'error', message: 'Stream title is empty — you may need to be live.' });
        } else if (data.is_live && data.stream_title) {
          const parsed = parseStreamTitleToCustom(data.stream_title);
          setKickStreamTitleCustom(parsed || (data.settings?.customTitle ?? ''));
        } else {
          setKickStreamTitleCustom(data.settings?.customTitle ?? data.stream_title ?? '');
        }
      }
      if (data.error && !data.stream_title) {
        setToast({ type: 'error', message: data.error });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to fetch stream title' });
    }
    setKickStreamTitleLoading(false);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const updateKickStreamTitle = useCallback(async () => {
    if (!kickStatus?.connected) return;
    setKickStreamTitleSaving(true);
    const locationPart = kickStreamTitleIncludeLocation ? (kickStreamTitleLocation || '') : '';
    const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart);
    try {
      const r = await authenticatedFetch('/api/kick-channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_title: fullTitle.trim(),
          settings: {
            customTitle: kickStreamTitleCustom,
            locationDisplay: kickStreamTitleLocationDisplay,
            autoUpdateLocation: kickStreamTitleAutoUpdate,
            includeLocationInTitle: kickStreamTitleIncludeLocation,
          },
        }),
      });
      const data = await r.json();
      if (r.ok) {
        lastPushedLocationRef.current = kickStreamTitleLocation || null;
        setToast({ type: 'saved', message: 'Saved!' });
      } else {
        setToast({ type: 'error', message: data.error ?? 'Failed to update' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to update stream title' });
    }
    setKickStreamTitleSaving(false);
    setTimeout(() => setToast(null), 3000);
  }, [kickStatus?.connected, kickStreamTitleCustom, kickStreamTitleLocation, kickStreamTitleLocationDisplay, kickStreamTitleAutoUpdate, kickStreamTitleIncludeLocation]);

  const saveKickMessages = useCallback(async (overrides?: {
    messages?: KickMessageTemplates;
    enabled?: KickMessageEnabled;
    templateEnabled?: KickMessageTemplateEnabled;
    alertSettings?: Partial<{
      minimumKicks: number;
      giftSubShowLifetimeSubs: boolean;
      chatBroadcastLocation: boolean;
      chatBroadcastLocationIntervalMin: number;
      chatBroadcastWeather: boolean;
      chatBroadcastHeartrate: boolean;
      chatBroadcastHeartrateMinBpm: number;
      chatBroadcastHeartrateVeryHighBpm: number;
      chatBroadcastSpeed: boolean;
      chatBroadcastSpeedMinKmh: number;
      chatBroadcastSpeedTimeoutMin: number;
      chatBroadcastAltitude: boolean;
      chatBroadcastAltitudeMinM: number;
      chatBroadcastAltitudeTimeoutMin: number;
    }>;
  }) => {
    const messages = overrides?.messages ?? kickMessages;
    const enabled = overrides?.enabled ?? kickMessageEnabled;
    const templateEnabled = overrides?.templateEnabled ?? kickTemplateEnabled;
    const alertSettings = overrides?.alertSettings ?? {
      minimumKicks: kickMinimumKicks,
      giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
      chatBroadcastLocation: kickChatBroadcastLocation,
      chatBroadcastLocationIntervalMin: 5,
      chatBroadcastWeather: kickChatBroadcastWeather,
      chatBroadcastHeartrate: kickChatBroadcastHeartrate,
      chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
      chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
      chatBroadcastSpeed: kickChatBroadcastSpeed,
      chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
      chatBroadcastSpeedTimeoutMin: 5,
      chatBroadcastAltitude: kickChatBroadcastAltitude,
      chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
      chatBroadcastAltitudeTimeoutMin: 5,
    };
    setToast({ type: 'saving', message: 'Saving...' });
    try {
      const r = await authenticatedFetch('/api/kick-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, enabled, templateEnabled, alertSettings }),
      });
      if (r.ok) {
        setToast({ type: 'saved', message: 'Saved!' });
      } else {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save');
      }
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
    }
    setTimeout(() => setToast(null), 3000);
  }, [kickMessages, kickMessageEnabled, kickTemplateEnabled, kickMinimumKicks, kickGiftSubShowLifetimeSubs, kickChatBroadcastLocation, kickChatBroadcastWeather, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm, kickChatBroadcastSpeed, kickChatBroadcastSpeedMinKmh, kickChatBroadcastAltitude, kickChatBroadcastAltitudeMinM]);

  const kickAlertSettingsRef = useRef({
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: 5,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
    chatBroadcastSpeed: kickChatBroadcastSpeed,
    chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
    chatBroadcastSpeedTimeoutMin: 5,
    chatBroadcastAltitude: kickChatBroadcastAltitude,
    chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
    chatBroadcastAltitudeTimeoutMin: 5,
  });
  kickAlertSettingsRef.current = {
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: 5,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
    chatBroadcastSpeed: kickChatBroadcastSpeed,
    chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
    chatBroadcastSpeedTimeoutMin: 5,
    chatBroadcastAltitude: kickChatBroadcastAltitude,
    chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
    chatBroadcastAltitudeTimeoutMin: 5,
  };
  kickMessagesRef.current = kickMessages;
  kickTemplateEnabledRef.current = kickTemplateEnabled;

  const scheduleKickMessagesSave = useCallback(() => {
    if (kickMessagesSaveTimeoutRef.current) clearTimeout(kickMessagesSaveTimeoutRef.current);
    kickMessagesSaveTimeoutRef.current = setTimeout(() => {
      kickMessagesSaveTimeoutRef.current = null;
      saveKickMessages({
        messages: kickMessagesRef.current,
        templateEnabled: kickTemplateEnabledRef.current,
        alertSettings: kickAlertSettingsRef.current,
      });
    }, 500);
  }, [saveKickMessages]);

  useEffect(() => () => {
    if (kickMessagesSaveTimeoutRef.current) clearTimeout(kickMessagesSaveTimeoutRef.current);
  }, []);

  const handleKickMessageChange = useCallback((key: keyof KickMessageTemplates, value: string) => {
    setKickMessages((prev) => {
      const next = { ...prev, [key]: value };
      kickMessagesRef.current = next;
      return next;
    });
    scheduleKickMessagesSave();
  }, [scheduleKickMessagesSave]);

  const handleKickOAuthConnect = useCallback(() => {
    const popup = window.open('/api/kick-oauth/authorize', 'kick_oauth', 'width=500,height=600');
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'kick_oauth_complete') return;
      clearInterval(poll);
      window.removeEventListener('message', handler);
      if (e.data.error) setToast({ type: 'error', message: e.data.error });
      else setToast({ type: 'saved', message: 'Saved!' });
      fetch('/api/kick-oauth/status', { credentials: 'include' }).then((r) => r.json()).then(setKickStatus);
      setTimeout(() => setToast(null), 3000);
    };
    const poll = setInterval(() => {
      if (popup?.closed) { clearInterval(poll); window.removeEventListener('message', handler); }
    }, 500);
    window.addEventListener('message', handler);
  }, []);

  const handleSettingsChange = useCallback(async (updates: Partial<OverlaySettings>) => {
    const mergedSettings = { ...settings, ...updates };
    
    // Handle minimap logic conflicts
    if (updates.showMinimap !== undefined) {
      if (updates.showMinimap) {
        mergedSettings.minimapSpeedBased = false;
      }
    }
    
    if (updates.minimapSpeedBased !== undefined) {
      if (updates.minimapSpeedBased) {
        mergedSettings.showMinimap = false;
      }
    }
    
    setSettings(mergedSettings);
    setToast({ type: 'saving', message: 'Saving...' });
    setSyncStatus('syncing');
    
    try {
      const res = await authenticatedFetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedSettings),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Save settings failed:', res.status, errorText);
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      
      setToast({ type: 'saved', message: 'Saved!' });
      setSyncStatus('connected');
      setTimeout(() => setToast(null), 2000);
    } catch (error) {
      console.error('Save settings error:', error);
      setToast({ type: 'error', message: `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}` });
      setSyncStatus('disconnected');
      setTimeout(() => setToast(null), 5000);
    }
  }, [settings]);

  // Debounced custom location handler
  const handleCustomLocationChange = useCallback((value: string) => {
    setCustomLocationInput(value);
    
    // Clear existing timeout
    if (customLocationTimeoutRef.current) {
      clearTimeout(customLocationTimeoutRef.current);
    }
    
    // Set new timeout to save after 1 second of no typing
    customLocationTimeoutRef.current = setTimeout(() => {
      handleSettingsChange({ customLocation: value });
    }, 1000);
  }, [handleSettingsChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (customLocationTimeoutRef.current) {
        clearTimeout(customLocationTimeoutRef.current);
      }
    };
  }, []);

  // Sync custom location input with settings when they change
  useEffect(() => {
    setCustomLocationInput(settings.customLocation || '');
  }, [settings.customLocation]);

  // Manual location update (browser geolocation, clear)
  const [locationFromBrowserLoading, setLocationFromBrowserLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) fetchLocationData();
  }, [isAuthenticated, settings.locationDisplay, fetchLocationData]); // Fetch on auth and when overlay display mode changes

  const handleGetLocationFromBrowser = useCallback(async () => {
    if (!navigator?.geolocation) {
      setToast({ type: 'error', message: 'Geolocation not supported by browser' });
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setLocationFromBrowserLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 0 });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const res = await authenticatedFetch('/api/set-location-from-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await fetchLocationData();
      setToast({ type: 'saved', message: 'Location updated from browser' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get location';
      setToast({ type: 'error', message: msg });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setLocationFromBrowserLoading(false);
    }
  }, [fetchLocationData]);

  const openPreview = () => {
    window.open('/overlay', '_blank');
  };


  // Show loading screen while checking authentication or loading settings
  if (!isAuthenticated || isLoading) return (
    <div className="admin-page">
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-icon">🎮</div>
          <div className="loading-text">
            {!isAuthenticated ? 'Checking authentication...' : 'Loading settings...'}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="admin-page">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="header-title">
            <span className="title-icon">🎮</span>
            <h1>Overlay Admin</h1>
            <div className={`sync-status ${syncStatus}`}>
              {syncStatus === 'connected' && '🟢'}
              {syncStatus === 'syncing' && '🟡'}
              {syncStatus === 'disconnected' && '🔴'}
            </div>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={openPreview}>
              👁️ Preview
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={async () => {
                try {
                  await fetch('/api/logout', { method: 'GET', credentials: 'include' });
                  router.push('/login');
                } catch (error) {
                  console.error('Logout error:', error);
                  router.push('/login');
                }
              }}
            >
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {toast.type === 'saving' && '⏳'}
              {toast.type === 'saved' && '✅'}
              {toast.type === 'error' && '❌'}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Main Content — single scrollable page with shared and tab-specific sections */}
      <main className="main-content">
        <div className="settings-container">
          {/* Location & map — at top for overlay display, stored location, map */}
          <section className="settings-section">
            <div className="section-header">
              <h2>📍 Location & map</h2>
            </div>
            <div className="setting-group">
              {/* Current location — prominent at top for quick visibility */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '20px',
                padding: '16px 18px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  {storedLocation ? (
                    <>
                      <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
                        {(() => {
                          // Format from raw + current overlay settings so granularity changes apply instantly (no wait for save)
                          const loc = kickStreamTitleRawLocation && settings.locationDisplay !== 'hidden'
                            ? formatLocation(kickStreamTitleRawLocation, settings.locationDisplay)
                            : { primary: storedLocation.primary, secondary: storedLocation.secondary };
                          const showPrimary = loc.primary || '';
                          const showSecondary = loc.secondary || '';
                          return showPrimary ? (showSecondary ? `${showPrimary} · ${showSecondary}` : showPrimary) : showSecondary;
                        })()}
                      </div>
                      {storedLocation.updatedAt && (
                        <span style={{ opacity: 0.7, fontSize: '0.8em', marginTop: 2, display: 'block' }}>
                          Updated {formatLocationAge(storedLocation.updatedAt)} ago
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ opacity: 0.6, fontSize: '0.95rem' }}>No location yet</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={handleGetLocationFromBrowser}
                  disabled={locationFromBrowserLoading}
                  title="Get from browser or refresh"
                  style={{ flexShrink: 0 }}
                >
                  {locationFromBrowserLoading ? '…' : 'Update'}
                </button>
              </div>

              <div className="admin-select-wrap">
                <label>Overlay display — granularity for overlay and chat (!location)</label>
                <select
                  className="admin-select-big"
                  value={settings.locationDisplay}
                  onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                >
                  <option value="neighbourhood">🏘️ Neighbourhood</option>
                  <option value="city">🏙️ City</option>
                  <option value="state">🗺️ State</option>
                  <option value="country">🌍 Country</option>
                  <option value="custom">✏️ Custom</option>
                  <option value="hidden">🚫 Hidden</option>
                </select>
              </div>
              <label className="checkbox-label" style={{ marginTop: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={settings.broadenLocationWhenStale !== false}
                  onChange={(e) => handleSettingsChange({ broadenLocationWhenStale: e.target.checked })}
                  className="checkbox-input"
                  style={{ marginTop: 3 }}
                />
                <span className="checkbox-text">
                  Broaden when GPS stale (neighbourhood→city→state→country) — when off, always use selected display mode
                </span>
              </label>
              {settings.broadenLocationWhenStale !== false && (
                <div className="admin-select-wrap" style={{ marginTop: '12px' }}>
                  <label>Max fallback when very stale</label>
                  <select
                    className="admin-select-big"
                    value={settings.locationStaleMaxFallback ?? 'country'}
                    onChange={(e) => handleSettingsChange({ locationStaleMaxFallback: e.target.value as LocationStaleMaxFallback })}
                  >
                    <option value="city">City (never beyond city)</option>
                    <option value="state">State (always state+country)</option>
                    <option value="country">Country (allow country-only)</option>
                  </select>
                </div>
              )}
              {settings.locationDisplay === 'custom' && (
                <div className="custom-location-input" style={{ marginTop: '12px' }}>
                  <label className="input-label">Custom Location Text</label>
                  <input
                    type="text"
                    value={customLocationInput}
                    onChange={(e) => handleCustomLocationChange(e.target.value)}
                    placeholder="Enter custom location (e.g., 'Tokyo, Japan' or 'Las Vegas Strip')"
                    className="text-input"
                    maxLength={50}
                  />
                  <div className="checkbox-group" style={{ marginTop: '12px' }}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={settings.showCountryName}
                        onChange={(e) => handleSettingsChange({ showCountryName: e.target.checked })}
                        className="checkbox-input"
                      />
                      <span className="checkbox-text">🏴 Show Country Name & Flag</span>
                    </label>
                  </div>
                </div>
              )}
              <p className="input-hint" style={{ marginTop: '12px', fontSize: '0.85em' }}>
                Update uses browser location; RTIRL overwrites when it provides newer data.
              </p>
            </div>
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <label className="group-label">Map</label>
              <div className="admin-select-wrap">
                <label>Map display</label>
                <select
                  className="admin-select-big"
                  value={settings.showMinimap ? 'always' : settings.minimapSpeedBased ? 'speed' : 'hidden'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'always') handleSettingsChange({ showMinimap: true, minimapSpeedBased: false });
                    else if (v === 'speed') handleSettingsChange({ showMinimap: false, minimapSpeedBased: true });
                    else handleSettingsChange({ showMinimap: false, minimapSpeedBased: false });
                  }}
                >
                  <option value="always">👁️ Always show</option>
                  <option value="speed">🏃 Auto on movement</option>
                  <option value="hidden">🚫 Hidden</option>
                </select>
              </div>
              <div className="admin-select-wrap">
                <label>Map zoom</label>
                <select
                  className="admin-select-big"
                  value={settings.mapZoomLevel}
                  onChange={(e) => handleSettingsChange({ mapZoomLevel: e.target.value as MapZoomLevel })}
                >
                  <option value="neighbourhood">🏘️ Neighbourhood</option>
                  <option value="city">🏙️ City</option>
                  <option value="state">🗺️ State</option>
                  <option value="country">🌍 Country</option>
                  <option value="ocean">🌊 Ocean</option>
                  <option value="continental">🌎 Continental</option>
                </select>
              </div>
              <div className="admin-select-wrap">
                <label>Map theme</label>
                <select
                  className="admin-select-big"
                  value={settings.minimapTheme || 'auto'}
                  onChange={(e) => handleSettingsChange({ minimapTheme: e.target.value as 'auto' | 'light' | 'dark' })}
                >
                  <option value="auto">🌓 Auto (light day, dark night)</option>
                  <option value="light">☀️ Light</option>
                  <option value="dark">🌙 Dark</option>
                </select>
              </div>
            </div>
          </section>

          {/* Stream title & chat */}
          <section className="settings-section">
            <div className="section-header">
              <h2>📺 Stream title & chat</h2>
            </div>
            <div className="setting-group">
              <h3 className="subsection-label">Stream title</h3>
              <p className="group-label group-description">
                Custom title + location (flag as separator). <strong>Fetch current</strong> (when live) parses from Kick. Auto-push only when <strong>live</strong>. If you get 401, use <strong>Reconnect</strong> in Connection section below.
              </p>
            <div className="form-stack">
              <div>
                <label className="field-label">Custom title</label>
                <input
                  type="text"
                  className="text-input"
                  value={kickStreamTitleCustom}
                  onChange={(e) => setKickStreamTitleCustom(e.target.value)}
                  placeholder="Add any title text..."
                  style={{ width: '100%', minWidth: 200 }}
                  maxLength={200}
                  disabled={!kickStatus?.connected}
                />
              </div>
              <div>
                <label className="field-label">Location</label>
                <p className="input-hint" style={{ marginBottom: '8px', fontSize: '0.85em' }}>
                  Preview when &quot;Include location&quot; is on:
                </p>
                <div
                  className="stream-title-location-preview"
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: '1.05rem',
                    fontWeight: 600,
                    minHeight: 48,
                    display: 'flex',
                    alignItems: 'center',
                    color: '#ffffff',
                    marginBottom: '12px',
                  }}
                >
                  {kickStreamTitleIncludeLocation && kickStreamTitleLocation
                    ? buildStreamTitle(kickStreamTitleCustom, kickStreamTitleLocation)
                    : kickStreamTitleCustom || <span style={{ opacity: 0.5 }}>No title yet</span>}
                </div>
                <div className="admin-select-wrap">
                  <label>Display granularity</label>
                  <select
                    className="admin-select-big"
                    value={kickStreamTitleLocationDisplay}
                    onChange={(e) => setKickStreamTitleLocationDisplay(e.target.value as StreamTitleLocationDisplay)}
                  >
                    <option value="city">🏙️ City</option>
                    <option value="state">🗺️ State</option>
                    <option value="country">🌍 Country</option>
                  </select>
                </div>
                <label className="checkbox-label-row" style={{ marginTop: '12px' }}>
                  <input
                    type="checkbox"
                    checked={kickStreamTitleIncludeLocation}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setKickStreamTitleIncludeLocation(checked);
                      if (kickStatus?.connected) {
                        const locationPart = checked ? (kickStreamTitleLocation || '') : '';
                        const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart);
                        try {
                          const r = await authenticatedFetch('/api/kick-channel', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              stream_title: fullTitle.trim(),
                              settings: {
                                customTitle: kickStreamTitleCustom,
                                locationDisplay: kickStreamTitleLocationDisplay,
                                autoUpdateLocation: kickStreamTitleAutoUpdate,
                                includeLocationInTitle: checked,
                              },
                            }),
                          });
                          if (r.ok) {
                            setToast({ type: 'saved', message: checked ? 'Location added to title' : 'Location hidden from title' });
                            setTimeout(() => setToast(null), 2500);
                          }
                        } catch {
                          setKickStreamTitleIncludeLocation(!checked);
                          setToast({ type: 'error', message: 'Failed to update' });
                          setTimeout(() => setToast(null), 3000);
                        }
                      }
                    }}
                    className="checkbox-input"
                  />
                  Include location in stream title (when off, title does not update on new location)
                </label>
                <label className="checkbox-label-row">
                  <input
                    type="checkbox"
                    checked={kickStreamTitleAutoUpdate}
                    onChange={(e) => setKickStreamTitleAutoUpdate(e.target.checked)}
                    className="checkbox-input"
                  />
                  Auto-push stream title when live and location changes (uses interval below)
                </label>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={fetchKickStreamTitle}
                  disabled={!kickStatus?.connected || kickStreamTitleLoading}
                >
                  {kickStreamTitleLoading ? 'Fetching…' : 'Fetch current'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={updateKickStreamTitle}
                  disabled={!kickStatus?.connected || kickStreamTitleSaving}
                >
                  {kickStreamTitleSaving ? 'Updating…' : 'Update'}
                </button>
              </div>
              </div>
            </div>

            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h3 className="subsection-label">Chat broadcasts</h3>
              <p className="group-label group-description">
                Location: when live, at most every 5 min (shared with stream title). Weather: notable changes only (rain, snow, storm, fog, high UV, poor air quality) — resends on new notable change, not when clearing. Heart rate: high/very-high warnings when crossing thresholds.
              </p>
            <div className="broadcast-options-list">
              <div className="broadcast-option-block">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input
                    type="checkbox"
                    checked={kickChatBroadcastLocation}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastLocation(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastLocation: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">📍</span>
                  <span>Location</span>
                </label>
                {(kickStreamTitleAutoUpdate || kickChatBroadcastLocation) && (
                  <div className="broadcast-option-detail">
                    <span className="checkbox-label-row-sm" style={{ opacity: 0.9 }}>Interval (stream title + chat, when live): 5 min</span>
                  </div>
                )}
              </div>
              <div className="broadcast-option-block">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input
                    type="checkbox"
                    checked={kickChatBroadcastWeather}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastWeather(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastWeather: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">🌤️</span>
                  <span>Weather</span>
                </label>
                {kickChatBroadcastWeather && (
                  <div className="broadcast-option-detail">
                    <span className="checkbox-label-row-sm" style={{ opacity: 0.9 }}>Notable changes: rain, snow, storm, fog, high UV (≥6), poor air quality (AQI ≥4) — posts on each new condition, not when clearing</span>
                  </div>
                )}
              </div>
              <div className="broadcast-option-block">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input
                    type="checkbox"
                    checked={kickChatBroadcastHeartrate}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastHeartrate(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastHeartrate: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">❤️</span>
                  <span>Heart rate</span>
                </label>
                {kickChatBroadcastHeartrate && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        High:
                        <input
                          type="number"
                          className="text-input number-input"
                          value={kickChatBroadcastHeartrateMinBpm}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 100));
                            setKickChatBroadcastHeartrateMinBpm(val);
                            saveKickMessages({ alertSettings: { chatBroadcastHeartrateMinBpm: val } });
                          }}
                          min={0}
                          max={250}
                        />
                        BPM
                      </label>
                      <label className="checkbox-label-row-sm">
                        Very high:
                        <input
                          type="number"
                          className="text-input number-input"
                          value={kickChatBroadcastHeartrateVeryHighBpm}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 120));
                            setKickChatBroadcastHeartrateVeryHighBpm(val);
                            saveKickMessages({ alertSettings: { chatBroadcastHeartrateVeryHighBpm: val } });
                          }}
                          min={0}
                          max={250}
                        />
                        BPM
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="broadcast-option-block">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input
                    type="checkbox"
                    checked={kickChatBroadcastSpeed}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastSpeed(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastSpeed: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">🚀</span>
                  <span>Speed (new top)</span>
                </label>
                {kickChatBroadcastSpeed && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        Min
                        <input
                          type="number"
                          className="text-input number-input"
                          value={kickChatBroadcastSpeedMinKmh}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 20));
                            setKickChatBroadcastSpeedMinKmh(val);
                            saveKickMessages({ alertSettings: { chatBroadcastSpeedMinKmh: val } });
                          }}
                          min={0}
                          max={500}
                        />
                        km/h
                      </label>
                      <span className="checkbox-label-row-sm" style={{ opacity: 0.9 }}>Timeout: 5 min</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="broadcast-option-block">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input
                    type="checkbox"
                    checked={kickChatBroadcastAltitude}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastAltitude(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastAltitude: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">⛰️</span>
                  <span>Altitude (new top)</span>
                </label>
                {kickChatBroadcastAltitude && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        Min
                        <input
                          type="number"
                          className="text-input number-input"
                          value={kickChatBroadcastAltitudeMinM}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(9000, parseInt(e.target.value, 10) || 50));
                            setKickChatBroadcastAltitudeMinM(val);
                            saveKickMessages({ alertSettings: { chatBroadcastAltitudeMinM: val } });
                          }}
                          min={0}
                          max={9000}
                        />
                        m
                      </label>
                      <span className="checkbox-label-row-sm" style={{ opacity: 0.9 }}>Timeout: 5 min</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
          </section>

          {/* === OVERLAY === */}
          {/* Weather, altitude & speed — overlay data displays (shared Always/Auto/Hidden pattern) */}
          <section className="settings-section">
            <div className="section-header">
              <h2>🌤️ Weather, altitude & speed</h2>
            </div>
            
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showWeather ?? false}
                    onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show temp</span>
                </label>
              </div>
              <div className="admin-select-wrap">
                <label>Weather conditions</label>
                <select
                  className="admin-select-big"
                  value={settings.weatherConditionDisplay || 'auto'}
                  onChange={(e) => handleSettingsChange({ weatherConditionDisplay: e.target.value as DisplayMode })}
                >
                  <option value="always">👁️ Always show</option>
                  <option value="auto">🌧️ Auto (rain, storms, snow)</option>
                  <option value="hidden">🚫 Hidden</option>
                </select>
              </div>
            </div>
            
            <div className="admin-select-wrap">
              <label>Altitude</label>
              <select
                className="admin-select-big"
                value={settings.altitudeDisplay || 'auto'}
                onChange={(e) => handleSettingsChange({ altitudeDisplay: e.target.value as DisplayMode })}
              >
                <option value="always">👁️ Always show</option>
                <option value="auto">📈 Auto (≥50m change)</option>
                <option value="hidden">🚫 Hidden</option>
              </select>
            </div>
            
            <div className="admin-select-wrap">
              <label>Speed</label>
              <select
                className="admin-select-big"
                value={settings.speedDisplay || 'auto'}
                onChange={(e) => handleSettingsChange({ speedDisplay: e.target.value as DisplayMode })}
              >
                <option value="always">👁️ Always show</option>
                <option value="auto">🏃 Auto (≥10 km/h)</option>
                <option value="hidden">🚫 Hidden</option>
              </select>
            </div>
          </section>

          {/* To-Do List Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>✅ To-Do List</h2>
              <div className="checkbox-group" style={{ marginTop: '8px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showTodoList ?? false}
                    onChange={(e) => handleSettingsChange({ showTodoList: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show on overlay</span>
                </label>
              </div>
            </div>
            
            <div className="setting-group">
              <div className="todo-input-group">
                <input
                  type="text"
                  placeholder="Add a new task..."
                  className="todo-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      const newTodo: TodoItem = {
                        id: Date.now().toString(),
                        text: e.currentTarget.value.trim(),
                        completed: false
                      };
                      const updatedTodos = [...(settings.todos || []), newTodo];
                      handleSettingsChange({ todos: updatedTodos });
                      e.currentTarget.value = '';
                    }
                  }}
                />
                <button 
                  className="btn btn-primary btn-small"
                  onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                    if (input && input.value.trim()) {
                      const newTodo: TodoItem = {
                        id: Date.now().toString(),
                        text: input.value.trim(),
                        completed: false
                      };
                      const updatedTodos = [...(settings.todos || []), newTodo];
                      handleSettingsChange({ todos: updatedTodos });
                      input.value = '';
                    }
                  }}
                >
                  Add
                </button>
              </div>


              {settings.todos && settings.todos.length > 0 && (
                <>
                  <div className="todo-list-actions">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        if (confirm('Are you sure you want to delete all tasks?')) {
                          handleSettingsChange({ todos: [] });
                        }
                      }}
                      disabled={!settings.todos || settings.todos.length === 0}
                    >
                      🗑️ Delete All
                    </button>
                  </div>
                  <div className="todo-list">
                    {[...(settings.todos || [])]
                      .sort((a, b) => {
                        // Incomplete tasks first, then completed tasks
                        if (a.completed === b.completed) return 0;
                        return a.completed ? 1 : -1;
                      })
                      .map((todo) => (
                      <div key={todo.id} className="todo-item-admin">
                        <label className="todo-checkbox-label">
                          <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={() => {
                              const updatedTodos = settings.todos!.map(t =>
                                t.id === todo.id ? { ...t, completed: !t.completed } : t
                              );
                              handleSettingsChange({ todos: updatedTodos });
                            }}
                            className="todo-checkbox"
                            disabled={editingTodoId === todo.id}
                          />
                          {editingTodoId === todo.id ? (
                            <input
                              type="text"
                              value={editingTodoText}
                              onChange={(e) => setEditingTodoText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (editingTodoText.trim()) {
                                    const updatedTodos = settings.todos!.map(t =>
                                      t.id === todo.id ? { ...t, text: editingTodoText.trim() } : t
                                    );
                                    handleSettingsChange({ todos: updatedTodos });
                                  }
                                  setEditingTodoId(null);
                                  setEditingTodoText('');
                                } else if (e.key === 'Escape') {
                                  setEditingTodoId(null);
                                  setEditingTodoText('');
                                }
                              }}
                              onBlur={() => {
                                if (editingTodoText.trim()) {
                                  const updatedTodos = settings.todos!.map(t =>
                                    t.id === todo.id ? { ...t, text: editingTodoText.trim() } : t
                                  );
                                  handleSettingsChange({ todos: updatedTodos });
                                }
                                setEditingTodoId(null);
                                setEditingTodoText('');
                              }}
                              className="todo-edit-input"
                              autoFocus
                            />
                          ) : (
                            <span 
                              className={`todo-text-admin ${todo.completed ? 'completed' : ''}`}
                              onDoubleClick={() => {
                                setEditingTodoId(todo.id);
                                setEditingTodoText(todo.text);
                              }}
                              style={{ cursor: 'pointer' }}
                              title="Double-click to edit"
                            >
                              {todo.text}
                            </span>
                          )}
                        </label>
                        <div className="todo-actions">
                          {editingTodoId !== todo.id && (
                            <button
                              className="todo-edit-btn"
                              onClick={() => {
                                setEditingTodoId(todo.id);
                                setEditingTodoText(todo.text);
                              }}
                              aria-label="Edit task"
                            >
                              ✏️
                            </button>
                          )}
                          <button
                            className="todo-delete-btn"
                            onClick={() => {
                              const updatedTodos = settings.todos!.filter(t => t.id !== todo.id);
                              handleSettingsChange({ todos: updatedTodos });
                            }}
                            aria-label="Delete task"
                            disabled={editingTodoId === todo.id}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* === KICK === */}
          <section className="settings-section">
            <div className="section-header">
              <h2>🔗 Connection</h2>
            </div>
                <div className="setting-group">
                  {kickStatus?.connected ? (
                  <div className="kick-status connected">
                    <span className="status-dot">🟢</span>
                    <span>Connected to kick.com/tazo</span>
                    {kickStatus.subscriptions && kickStatus.subscriptions.length > 0 && (
                      <span className="subscription-count">
                        ({kickStatus.subscriptions.length} event subscriptions)
                      </span>
                    )}
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          if (!confirm('Disconnect Kick? Event subscriptions and chat responses will stop.')) return;
                          try {
                            const r = await fetch('/api/kick-oauth/disconnect', {
                              method: 'POST',
                              credentials: 'include',
                            });
                            const d = await r.json();
                            if (r.ok) {
                              setKickStatus({ connected: false });
                              setToast({ type: 'saved', message: 'Disconnected' });
                            } else {
                              setToast({ type: 'error', message: d.error ?? 'Failed' });
                            }
                          } catch {
                            setToast({ type: 'error', message: 'Failed to disconnect' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        Disconnect
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={handleKickOAuthConnect}
                      >
                        🔄 Reconnect
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          try {
                            const r = await fetch('/api/kick-oauth/subscribe', {
                              method: 'POST',
                              credentials: 'include',
                            });
                            const data = await r.json();
                            if (r.ok) {
                              setToast({ type: 'saved', message: 'Re-subscribed!' });
                              fetch('/api/kick-oauth/status', { credentials: 'include' })
                                .then((res) => res.json())
                                .then(setKickStatus);
                            } else {
                              setToast({ type: 'error', message: data.error ?? 'Failed' });
                            }
                          } catch {
                            setToast({ type: 'error', message: 'Re-subscribe failed' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        📡 Re-subscribe
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="kick-status disconnected">
                    <span className="status-dot">🔴</span>
                    <span>Not connected</span>
                    <button
                      type="button"
                      className="btn btn-primary connect-kick-btn"
                      onClick={handleKickOAuthConnect}
                    >
                      Connect Kick
                    </button>
                  </div>
                )}
                </div>
              </section>

              <section className="settings-section">
                <div className="section-header">
                  <h2>🗳️ Poll</h2>
                </div>
                <div className="setting-group">
                  <p className="group-label group-description group-description-sm">
                    Mods/broadcaster start polls with <code>!poll Question? Option1, Option2</code> or <code>!poll Food? Pizza burger chips</code> (space-separated when no commas). No options = Yes/No. Vote by typing option text (e.g. pizza, yes). Winner posts in chat and overlay. Mods and broadcaster can use <code>!endpoll</code> to end the current poll early.
                  </p>
                  <div className="form-stack" style={{ maxWidth: 520 }}>
                    <label className="checkbox-label-row">
                      <input
                        type="checkbox"
                        checked={kickPollEnabled}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          setKickPollEnabled(checked);
                          try {
                            await authenticatedFetch('/api/kick-poll-settings', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: checked }),
                            });
                            setToast({ type: 'saved', message: 'Saved!' });
                          } catch {
                            setKickPollEnabled(!checked);
                            setToast({ type: 'error', message: 'Failed to save' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                        className="checkbox-input"
                      />
                      <span>Enable chat-based poll</span>
                    </label>
                    {kickPollEnabled && (
                      <>
                        <div className="admin-select-wrap">
                          <label>Duration (sec)</label>
                          <select
                            className="admin-select-big"
                            value={kickPollDuration}
                            onChange={async (e) => {
                              const val = parseInt(e.target.value, 10);
                              setKickPollDuration(val);
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ durationSeconds: val }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch { /* ignore */ }
                              setTimeout(() => setToast(null), 2000);
                            }}
                          >
                            {(() => {
                              const presets = [5, 15, 30, 45, 60, 90, 120, 180, 300];
                              const opts = [...new Set([...presets, Math.max(5, Math.min(300, kickPollDuration))])].sort((a, b) => a - b);
                              return opts.map((n) => <option key={n} value={n}>{n} sec</option>);
                            })()}
                          </select>
                        </div>
                        <div className="kick-group-options" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                          <span className="kick-group-options-label">Who can start polls:</span>
                          <label className="checkbox-label-row">
                            <input
                              type="checkbox"
                              checked={kickPollEveryoneCanStart}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setKickPollEveryoneCanStart(checked);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ everyoneCanStart: checked }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { setKickPollEveryoneCanStart(!checked); }
                                setTimeout(() => setToast(null), 2000);
                              }}
                              className="checkbox-input"
                            />
                            <span>Everyone</span>
                          </label>
                          <label className="checkbox-label-row">
                            <input
                              type="checkbox"
                              checked={kickPollModsCanStart}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setKickPollModsCanStart(checked);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ modsCanStart: checked }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { setKickPollModsCanStart(!checked); }
                                setTimeout(() => setToast(null), 2000);
                              }}
                              className="checkbox-input"
                            />
                            <span>Mods</span>
                          </label>
                          <label className="checkbox-label-row">
                            <input
                              type="checkbox"
                              checked={kickPollVipsCanStart}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setKickPollVipsCanStart(checked);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ vipsCanStart: checked }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { setKickPollVipsCanStart(!checked); }
                                setTimeout(() => setToast(null), 2000);
                              }}
                              className="checkbox-input"
                            />
                            <span>VIPs</span>
                          </label>
                          <label className="checkbox-label-row">
                            <input
                              type="checkbox"
                              checked={kickPollOgsCanStart}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setKickPollOgsCanStart(checked);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ ogsCanStart: checked }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { setKickPollOgsCanStart(!checked); }
                                setTimeout(() => setToast(null), 2000);
                              }}
                              className="checkbox-input"
                            />
                            <span>OGs</span>
                          </label>
                          <label className="checkbox-label-row">
                            <input
                              type="checkbox"
                              checked={kickPollSubsCanStart}
                              onChange={async (e) => {
                                const checked = e.target.checked;
                                setKickPollSubsCanStart(checked);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ subsCanStart: checked }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { setKickPollSubsCanStart(!checked); }
                                setTimeout(() => setToast(null), 2000);
                              }}
                              className="checkbox-input"
                            />
                            <span>Subs</span>
                          </label>
                        </div>
                        <label className="checkbox-label-row">
                          <input
                            type="checkbox"
                            checked={kickPollOneVotePerPerson}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              setKickPollOneVotePerPerson(checked);
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ oneVotePerPerson: checked }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch {
                                setKickPollOneVotePerPerson(!checked);
                                setToast({ type: 'error', message: 'Failed to save' });
                              }
                              setTimeout(() => setToast(null), 2000);
                            }}
                            className="checkbox-input"
                          />
                          <span>One vote per person</span>
                        </label>
                        <div className="admin-select-wrap">
                          <label>Max queued polls</label>
                          <select
                            className="admin-select-big"
                            value={kickPollMaxQueued}
                            onChange={async (e) => {
                              const val = parseInt(e.target.value, 10);
                              setKickPollMaxQueued(val);
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ maxQueuedPolls: val }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch { /* ignore */ }
                              setTimeout(() => setToast(null), 2000);
                            }}
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </div>
                        <label className="checkbox-label-row">
                          <input
                            type="checkbox"
                            checked={kickPollAutoStart}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              setKickPollAutoStart(checked);
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ autoStartPollsEnabled: checked }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch { setKickPollAutoStart(!checked); }
                              setTimeout(() => setToast(null), 2000);
                            }}
                            className="checkbox-input"
                          />
                          <span>Auto-start polls when stream live + no poll run in X min</span>
                        </label>
                        {kickPollAutoStart && (
                          <div className="admin-select-wrap">
                            <label>Min since last poll before auto-start</label>
                            <select
                              className="admin-select-big"
                              value={kickPollMinutesSinceLastPoll}
                              onChange={async (e) => {
                                const val = parseInt(e.target.value, 10);
                                setKickPollMinutesSinceLastPoll(val);
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ minutesSinceLastPoll: val }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { /* ignore */ }
                                setTimeout(() => setToast(null), 2000);
                              }}
                            >
                              {[1, 2, 3, 5, 10, 15, 20, 30].map((n) => (
                                <option key={n} value={n}>{n} min</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>

              {/* Message templates */}
              <section className="settings-section">
                <div className="section-header">
                  <h2>📋 Message templates</h2>
                </div>
                <div className="setting-group">
                  <p className="group-label group-description">
                    Enable each event type and edit templates. Placeholders: {'{name}'}, {'{gifter}'}, {'{months}'}, {'{count}'}, {'{lifetimeSubs}'}, {'{sender}'}, {'{amount}'}, {'{kickDescription}'}, {'{redeemer}'}, {'{title}'}, {'{userInput}'}, {'{message}'}.
                  </p>
                <div className="form-stack">
                  {TEMPLATE_GROUP_CONFIG.map((group) => (
                    <div key={group.toggleKey} className="kick-message-group kick-message-card">
                      {(group.toggleKey === 'giftSub' || group.toggleKey === 'kicksGifted') && (
                        <div className="kick-group-options">
                          <span className="kick-group-options-label">Options:</span>
                          {group.toggleKey === 'giftSub' && (
                            <label className="kick-group-options-item">
                              <input
                                type="checkbox"
                                checked={kickGiftSubShowLifetimeSubs}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setKickGiftSubShowLifetimeSubs(checked);
                                  saveKickMessages({ alertSettings: { giftSubShowLifetimeSubs: checked } });
                                }}
                                className="checkbox-input"
                              />
                              <span>Show lifetime subs in message</span>
                            </label>
                          )}
                          {group.toggleKey === 'kicksGifted' && (
                            <label className="kick-group-options-item">
                              <span>Min kicks to alert:</span>
                              <input
                                type="number"
                                className="text-input number-input kick-group-options-input"
                                value={kickMinimumKicks}
                                onChange={(e) => {
                                  setKickMinimumKicks(Math.max(0, parseInt(e.target.value, 10) || 0));
                                  scheduleKickMessagesSave();
                                }}
                                min={0}
                              />
                            </label>
                          )}
                        </div>
                      )}
                      {group.templateKeys.map((key) => (
                        <div
                          key={key}
                          className={`kick-message-row kick-message-template-row kick-message-row-with-toggle ${kickTemplateEnabled[key] === false ? 'kick-message-card-disabled' : ''}`}
                        >
                          <label className="checkbox-label-row kick-event-toggle">
                            <input
                              type="checkbox"
                              checked={kickTemplateEnabled[key] !== false}
                              onChange={(e) => handleKickTemplateToggleChange(key, e.target.checked)}
                              className="checkbox-input"
                            />
                            <span className="radio-icon" aria-hidden="true">{TEMPLATE_GROUP_ICONS[group.toggleKey]}</span>
                            <span className="kick-template-label">{KICK_MESSAGE_LABELS[key]}</span>
                          </label>
                          <input
                            type="text"
                            className="text-input"
                            value={kickMessages[key]}
                            onChange={(e) => handleKickMessageChange(key, e.target.value)}
                            placeholder={DEFAULT_KICK_MESSAGES[key]}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="section-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setKickMessages(DEFAULT_KICK_MESSAGES);
                      saveKickMessages({ messages: DEFAULT_KICK_MESSAGES, templateEnabled: kickTemplateEnabled });
                    }}
                  >
                    Reset to defaults
                  </button>
                </div>
                </div>
              </section>
        </div>
      </main>

      {/* Sticky actions for mobile */}
      <div className="admin-sticky-actions">
        <button className="btn btn-secondary" onClick={openPreview}>👁️ Preview</button>
        <button 
          className="btn btn-primary" 
          onClick={async () => {
            try {
              await fetch('/api/logout', { method: 'GET', credentials: 'include' });
              router.push('/login');
            } catch (error) {
              console.error('Logout error:', error);
              router.push('/login');
            }
          }}
        >🚪 Logout</button>
      </div>
    </div>
  );
} 