"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, MapZoomLevel, DisplayMode, TodoItem } from '@/types/settings';
import {
  DEFAULT_KICK_MESSAGES,
  TEMPLATE_GROUP_CONFIG,
  TEMPLATE_GROUP_ICONS,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled, KickMessageTemplateEnabled } from '@/types/kick-messages';
import { formatLocationForStreamTitle, parseStreamTitleToCustom, buildStreamTitle } from '@/utils/stream-title-utils';
import type { StreamTitleLocationDisplay } from '@/utils/stream-title-utils';
import type { LocationData } from '@/utils/location-utils';
import '@/styles/admin.css';

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
  const [kickChatBroadcastLocationInterval, setKickChatBroadcastLocationInterval] = useState(5);
  const [kickChatBroadcastHeartrate, setKickChatBroadcastHeartrate] = useState(false);
  const [kickChatBroadcastHeartrateMinBpm, setKickChatBroadcastHeartrateMinBpm] = useState(100);
  const [kickChatBroadcastHeartrateVeryHighBpm, setKickChatBroadcastHeartrateVeryHighBpm] = useState(120);
  const [kickBroadcastStatus, setKickBroadcastStatus] = useState<{
    heartRate?: { currentBpm: number; age: string; hasData: boolean; state: string; reason: string; wouldSendMessage: boolean; lastSentAt: string | null; lastSentAgo: string | null };
    kick?: { hasTokens: boolean };
    cron?: { runsEvery: string; note: string };
  } | null>(null);
  const [kickStreamTitleCustom, setKickStreamTitleCustom] = useState('');
  const [kickStreamTitleLocationDisplay, setKickStreamTitleLocationDisplay] = useState<StreamTitleLocationDisplay>('state');
  const [kickStreamTitleAutoUpdate, setKickStreamTitleAutoUpdate] = useState(true);
  const [kickStreamTitleIncludeLocation, setKickStreamTitleIncludeLocation] = useState(true);
  const [kickStreamTitleLocation, setKickStreamTitleLocation] = useState<string>('');
  const [kickStreamTitleRawLocation, setKickStreamTitleRawLocation] = useState<LocationData | null>(null);
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
  const [kickPollChatIdleMinutes, setKickPollChatIdleMinutes] = useState(5);
  const [kickPollOneVotePerPerson, setKickPollOneVotePerPerson] = useState(false);
  const [activeTab, setActiveTab] = useState<'overlay' | 'kick'>('overlay');

  

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
        if (d.alertSettings?.chatBroadcastLocationIntervalMin != null) setKickChatBroadcastLocationInterval(d.alertSettings.chatBroadcastLocationIntervalMin);
        if (d.alertSettings?.chatBroadcastHeartrate !== undefined) setKickChatBroadcastHeartrate(d.alertSettings.chatBroadcastHeartrate);
        if (d.alertSettings?.chatBroadcastHeartrateMinBpm != null) setKickChatBroadcastHeartrateMinBpm(d.alertSettings.chatBroadcastHeartrateMinBpm);
        if (d.alertSettings?.chatBroadcastHeartrateVeryHighBpm != null) setKickChatBroadcastHeartrateVeryHighBpm(d.alertSettings.chatBroadcastHeartrateVeryHighBpm);
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
        if (d?.chatIdleMinutes != null) setKickPollChatIdleMinutes(d.chatIdleMinutes);
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

  const fetchLocationForStreamTitle = useCallback(async () => {
    try {
      const locRes = await fetch('/api/get-location', { credentials: 'include' });
      const locData = await locRes.json();
      const raw = locData?.rawLocation ?? locData?.location;
      if (raw) {
        setKickStreamTitleRawLocation(raw);
        const display = kickStreamTitleLocationDisplayRef.current;
        setKickStreamTitleLocation(formatLocationForStreamTitle(raw, display));
      } else {
        setKickStreamTitleLocation('');
        setKickStreamTitleRawLocation(null);
      }
    } catch {
      setKickStreamTitleLocation('');
      setKickStreamTitleRawLocation(null);
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
    fetchLocationForStreamTitle();
  }, [fetchLocationForStreamTitle]);

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
      chatBroadcastHeartrate: boolean;
      chatBroadcastHeartrateMinBpm: number;
      chatBroadcastHeartrateVeryHighBpm: number;
    }>;
  }) => {
    const messages = overrides?.messages ?? kickMessages;
    const enabled = overrides?.enabled ?? kickMessageEnabled;
    const templateEnabled = overrides?.templateEnabled ?? kickTemplateEnabled;
    const alertSettings = overrides?.alertSettings ?? {
      minimumKicks: kickMinimumKicks,
      giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
      chatBroadcastLocation: kickChatBroadcastLocation,
      chatBroadcastLocationIntervalMin: kickChatBroadcastLocationInterval,
      chatBroadcastHeartrate: kickChatBroadcastHeartrate,
      chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
      chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
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
  }, [kickMessages, kickMessageEnabled, kickTemplateEnabled, kickMinimumKicks, kickGiftSubShowLifetimeSubs, kickChatBroadcastLocation, kickChatBroadcastLocationInterval, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm]);

  const kickAlertSettingsRef = useRef({
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: kickChatBroadcastLocationInterval,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
  });
  kickAlertSettingsRef.current = {
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: kickChatBroadcastLocationInterval,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
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
  const [locationClearLoading, setLocationClearLoading] = useState(false);

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
      await fetchLocationForStreamTitle();
      setToast({ type: 'saved', message: 'Location updated from browser' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get location';
      setToast({ type: 'error', message: msg });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setLocationFromBrowserLoading(false);
    }
  }, [fetchLocationForStreamTitle]);

  const handleHideLocationInStreamTitle = useCallback(async () => {
    setLocationClearLoading(true);
    try {
      const custom = kickStreamTitleCustom.trim();
      const r = await authenticatedFetch('/api/kick-channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_title: custom || '',
          settings: { includeLocationInTitle: false },
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      setKickStreamTitleIncludeLocation(false);
      setKickStreamTitleLocation('');
      setKickStreamTitleRawLocation(null);
      setToast({ type: 'saved', message: "Stream title won't show location — turn it back on in Kick Bot tab" });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update';
      setToast({ type: 'error', message: msg });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setLocationClearLoading(false);
    }
  }, [kickStreamTitleCustom]);

  const openPreview = () => {
    window.open('/overlay', '_blank');
  };




  // Simple Radio Group Component
  const RadioGroup = ({ 
    options, 
    value, 
    onChange
  }: { 
    options: { value: string; label: string; icon: string; description?: string }[]; 
    value: string; 
    onChange: (value: string) => void; 
  }) => (
    <div className="radio-group segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          className={`radio-option ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          type="button"
          tabIndex={0}
        >
          <span className="radio-icon" aria-hidden="true">{option.icon}</span>
          <div className="radio-content">
            <span className="radio-label">{option.label}</span>
            {option.description && (
              <span className="radio-description">{option.description}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );

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

      {/* Tab Bar */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'overlay' ? 'active' : ''}`}
          onClick={() => setActiveTab('overlay')}
          type="button"
        >
          🎮 Overlay
        </button>
        <button
          className={`admin-tab ${activeTab === 'kick' ? 'active' : ''}`}
          onClick={() => setActiveTab('kick')}
          type="button"
        >
          🤖 Kick Bot
        </button>
      </div>

      {/* Main Content */}
      <main className="main-content">
        <div className="settings-container">
          {activeTab === 'overlay' && (
            <>
          {/* Location Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>📍 Location</h2>
            </div>
            
            <div className="setting-group">
              <label className="group-label">Location Mode</label>
              <RadioGroup
                value={settings.locationDisplay}
                onChange={(value) => handleSettingsChange({ locationDisplay: value as LocationDisplayMode })}
                options={[
                  { 
                    value: 'neighbourhood', 
                    label: 'Neighbourhood', 
                    icon: '🏘️'
                  },
                  { 
                    value: 'city', 
                    label: 'City', 
                    icon: '🏙️'
                  },
                  { 
                    value: 'state', 
                    label: 'State', 
                    icon: '🗺️'
                  },
                  { 
                    value: 'country', 
                    label: 'Country', 
                    icon: '🌍'
                  },
                  { 
                    value: 'custom', 
                    label: 'Custom', 
                    icon: '✏️'
                  },
                  { 
                    value: 'hidden', 
                    label: 'Hidden', 
                    icon: '🚫'
                  }
                ]}
              />
              
              {/* Custom location input */}
              {settings.locationDisplay === 'custom' && (
                <div className="custom-location-input">
                  <label className="input-label">Custom Location Text</label>
                  <input
                    type="text"
                    value={customLocationInput}
                    onChange={(e) => handleCustomLocationChange(e.target.value)}
                    placeholder="Enter custom location (e.g., 'Tokyo, Japan' or 'Las Vegas Strip')"
                    className="text-input"
                    maxLength={50}
                  />
                  
                  {/* Country name toggle for custom location */}
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

              {/* Manual location update */}
              <div className="setting-group" style={{ marginTop: '16px' }}>
                <label className="group-label">Manual Location Update</label>
                <p className="input-hint" style={{ marginBottom: '8px' }}>
                  Get from browser overrides overlay/stream title until RTIRL provides new data. Hide in title removes location from stream title only (overlay and chat keep location).
                </p>
                <div className="button-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleGetLocationFromBrowser}
                    disabled={locationFromBrowserLoading}
                  >
                    {locationFromBrowserLoading ? 'Getting location…' : '📍 Get from browser'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleHideLocationInStreamTitle}
                    disabled={locationClearLoading}
                  >
                    {locationClearLoading ? 'Updating…' : 'Hide location in stream title'}
                  </button>
                </div>
              </div>
              
            </div>
          </section>

          {/* Map Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>🗺️ Map</h2>
            </div>
            
            <div className="setting-group">
              <label className="group-label">Display Mode</label>
              <RadioGroup
                value={settings.showMinimap ? 'always' : settings.minimapSpeedBased ? 'speed' : 'hidden'}
                onChange={(value) => {
                  if (value === 'always') {
                    handleSettingsChange({ showMinimap: true, minimapSpeedBased: false });
                  } else if (value === 'speed') {
                    handleSettingsChange({ showMinimap: false, minimapSpeedBased: true });
                  } else {
                    handleSettingsChange({ showMinimap: false, minimapSpeedBased: false });
                  }
                }}
                options={[
                  { value: 'always', label: 'Always Show', icon: '👁️' },
                  { value: 'speed', label: 'Auto on Movement', icon: '🏃' },
                  { value: 'hidden', label: 'Hidden', icon: '🚫' }
                ]}
              />
              
            </div>
            
            <div className="setting-group">
              <label className="group-label">Zoom Level</label>
              <RadioGroup
                value={settings.mapZoomLevel}
                onChange={(value) => handleSettingsChange({ mapZoomLevel: value as MapZoomLevel })}
                options={[
                  { value: 'neighbourhood', label: 'Neighbourhood', icon: '🏘️' },
                  { value: 'city', label: 'City', icon: '🏙️' },
                  { value: 'state', label: 'State', icon: '🗺️' },
                  { value: 'country', label: 'Country', icon: '🌍' },
                  { value: 'ocean', label: 'Ocean', icon: '🌊' },
                  { value: 'continental', label: 'Continental', icon: '🌎' }
                ]}
              />
            </div>
            
            <div className="setting-group">
              <label className="group-label">Theme</label>
              <RadioGroup
                value={settings.minimapTheme || 'auto'}
                onChange={(value) => handleSettingsChange({ minimapTheme: value as 'auto' | 'light' | 'dark' })}
                options={[
                  { value: 'auto', label: 'Auto', icon: '🌓', description: 'Light during day, dark at night' },
                  { value: 'light', label: 'Light', icon: '☀️', description: 'Always light theme' },
                  { value: 'dark', label: 'Dark', icon: '🌙', description: 'Always dark theme' }
                ]}
              />
            </div>
          </section>

          {/* Weather Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>🌤️ Weather</h2>
            </div>
            
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '16px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showWeather ?? false}
                    onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show Temp/Weather</span>
                </label>
              </div>
              
              <label className="group-label">Condition Icon & Text</label>
              <RadioGroup
                value={settings.weatherConditionDisplay || 'auto'}
                onChange={(value) => handleSettingsChange({ weatherConditionDisplay: value as DisplayMode })}
                options={[
                  { value: 'always', label: 'Always Show', icon: '👁️' },
                  { value: 'auto', label: 'Auto', icon: '🌧️', description: 'Shows icon/text for rain, storms, snow, etc.' },
                  { value: 'hidden', label: 'Hidden', icon: '🚫' }
                ]}
              />
            </div>
          </section>

          {/* Altitude & Speed Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>📊 Altitude & Speed</h2>
            </div>
            
            <div className="setting-group">
              <label className="group-label">Altitude Display</label>
              <RadioGroup
                value={settings.altitudeDisplay || 'auto'}
                onChange={(value) => handleSettingsChange({ altitudeDisplay: value as DisplayMode })}
                options={[
                  { value: 'always', label: 'Always Show', icon: '👁️' },
                  { value: 'auto', label: 'Auto', icon: '📈', description: 'Shows when elevation >500m (mountains/hills)' },
                  { value: 'hidden', label: 'Hidden', icon: '🚫' }
                ]}
              />
            </div>
            
            <div className="setting-group">
              <label className="group-label">Speed Display</label>
              <RadioGroup
                value={settings.speedDisplay || 'auto'}
                onChange={(value) => handleSettingsChange({ speedDisplay: value as DisplayMode })}
                options={[
                  { value: 'always', label: 'Always Show', icon: '👁️' },
                  { value: 'auto', label: 'Auto', icon: '🏃', description: 'Shows when ≥10 km/h. Hides when GPS stale (>10s)' },
                  { value: 'hidden', label: 'Hidden', icon: '🚫' }
                ]}
              />
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
            </>
          )}

          {activeTab === 'kick' && (
            <>
              {/* Connection */}
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

              {/* Stream title */}
              <section className="settings-section">
                <div className="section-header">
                  <h2>📺 Stream title</h2>
                </div>
                <div className="setting-group">
                  <p className="group-label group-description">
                    Custom title + location (flag as separator). <strong>Fetch current</strong> (when live) parses from Kick. Auto-push only when <strong>live</strong>. If you get 401, use <strong>Reconnect</strong> above.
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                          }}
                        >
                          {kickStreamTitleLocation || <span style={{ opacity: 0.5 }}>No location data</span>}
                        </div>
                        <div>
                          <label className="field-label field-label-sm">Display</label>
                          <RadioGroup
                          value={kickStreamTitleLocationDisplay}
                          onChange={(v) => setKickStreamTitleLocationDisplay(v as StreamTitleLocationDisplay)}
                          options={[
                            { value: 'city', label: 'City', icon: '🏙️' },
                            { value: 'state', label: 'State', icon: '🗺️' },
                            { value: 'country', label: 'Country', icon: '🌍' },
                          ]}
                        />
                        </div>
                      </div>
                      <label className="checkbox-label-row">
                        <input
                          type="checkbox"
                          checked={kickStreamTitleAutoUpdate}
                          onChange={(e) => setKickStreamTitleAutoUpdate(e.target.checked)}
                          className="checkbox-input"
                        />
                        Auto-push stream title when live and location changes (uses interval below)
                      </label>
                      <label className="checkbox-label-row">
                        <input
                          type="checkbox"
                          checked={kickStreamTitleIncludeLocation}
                          onChange={(e) => setKickStreamTitleIncludeLocation(e.target.checked)}
                          className="checkbox-input"
                        />
                        Include location in stream title (uncheck to hide location in title only; overlay and chat keep location)
                      </label>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
                      className="btn btn-secondary btn-small"
                      onClick={fetchLocationForStreamTitle}
                    >
                      Refresh location
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
              </section>

              {/* Chat broadcasts */}
              <section className="settings-section">
                <div className="section-header">
                  <h2>📢 Chat broadcasts</h2>
                </div>
                <div className="setting-group">
                  <p className="group-label group-description">
                    Location: when live, at most every N min (shared with stream title above). Toggle below to also post in chat. Heart rate: high/very-high warnings when crossing thresholds. No spam until HR drops below, then exceeds again.
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
                        <label className="checkbox-label-row-sm">
                          Interval (stream title + chat, when live):
                          <input
                            type="number"
                            className="text-input number-input"
                            value={kickChatBroadcastLocationInterval}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value, 10) || 5);
                              setKickChatBroadcastLocationInterval(val);
                              saveKickMessages({ alertSettings: { chatBroadcastLocationIntervalMin: val } });
                            }}
                            min={1}
                            max={60}
                          />
                          min
                        </label>
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
                </div>
                <div className="broadcast-status-block">
                  <div className="broadcast-status-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        try {
                          const r = await fetch('/api/cron/kick-chat-broadcast/status', { credentials: 'include' });
                          const data = await r.json();
                          setKickBroadcastStatus(data);
                        } catch {
                          setKickBroadcastStatus(null);
                        }
                      }}
                    >
                      Check broadcast status
                    </button>
                    {kickBroadcastStatus?.heartRate?.state !== 'below' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          try {
                            await fetch('/api/cron/kick-chat-broadcast/status', {
                              method: 'POST',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ resetHrState: true }),
                            });
                            setToast({ type: 'saved', message: 'Saved!' });
                            setTimeout(() => setToast(null), 3000);
                            const r = await fetch('/api/cron/kick-chat-broadcast/status', { credentials: 'include' });
                            const data = await r.json();
                            setKickBroadcastStatus(data);
                          } catch {
                            setToast({ type: 'error', message: 'Reset failed' });
                            setTimeout(() => setToast(null), 3000);
                          }
                        }}
                      >
                        Reset HR state (retest)
                      </button>
                    )}
                  </div>
                  {kickBroadcastStatus && (
                    <div className="broadcast-status-details">
                      {kickBroadcastStatus.heartRate && (
                        <div>
                          <strong>Heart rate:</strong> {kickBroadcastStatus.heartRate.currentBpm} BPM ({kickBroadcastStatus.heartRate.age})
                          {!kickBroadcastStatus.heartRate.hasData && (
                            <p className="broadcast-status-warning">No HR data — keep overlay open with Pulsoid connected. Data is stored when the overlay sends it.</p>
                          )}
                          <p>{kickBroadcastStatus.heartRate.reason}</p>
                          <p className="broadcast-status-note">
                            {kickBroadcastStatus.heartRate.lastSentAgo
                              ? `Last message sent: ${kickBroadcastStatus.heartRate.lastSentAgo}`
                              : 'No HR message sent recently'}
                          </p>
                          {kickBroadcastStatus.heartRate.wouldSendMessage && (
                            <p className="broadcast-status-ok">Next cron run would send a message.</p>
                          )}
                        </div>
                      )}
                      {kickBroadcastStatus.kick && !kickBroadcastStatus.kick.hasTokens && (
                        <p className="broadcast-status-warning">Kick not connected — connect in Kick Bot tab.</p>
                      )}
                      {kickBroadcastStatus.cron && (
                        <p className="broadcast-status-note">Cron: {kickBroadcastStatus.cron.runsEvery}. {kickBroadcastStatus.cron.note}</p>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </section>

              {/* Chat Poll */}
              <section className="settings-section">
                <div className="section-header">
                  <h2>🗳️ Chat poll</h2>
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
                        <label className="kick-group-options-item">
                          <span>Duration (sec):</span>
                          <input
                            type="number"
                            className="text-input number-input kick-group-options-input"
                            value={kickPollDuration}
                            onChange={(e) => setKickPollDuration(Math.max(5, Math.min(300, parseInt(e.target.value, 10) || 60)))}
                            min={5}
                            max={300}
                            style={{ width: 72 }}
                            onBlur={async () => {
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ durationSeconds: kickPollDuration }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch { /* ignore */ }
                              setTimeout(() => setToast(null), 2000);
                            }}
                          />
                        </label>
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
                        <label className="kick-group-options-item">
                          <span>Max queued polls:</span>
                          <input
                            type="number"
                            className="text-input number-input kick-group-options-input"
                            value={kickPollMaxQueued}
                            onChange={(e) => setKickPollMaxQueued(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 5)))}
                            min={1}
                            max={20}
                            style={{ width: 52 }}
                            onBlur={async () => {
                              try {
                                await authenticatedFetch('/api/kick-poll-settings', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ maxQueuedPolls: kickPollMaxQueued }),
                                });
                                setToast({ type: 'saved', message: 'Saved!' });
                              } catch { /* ignore */ }
                              setTimeout(() => setToast(null), 2000);
                            }}
                          />
                        </label>
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
                          <span>Auto-start polls when stream live + chat idle</span>
                        </label>
                        {kickPollAutoStart && (
                          <label className="kick-group-options-item">
                            <span>Chat idle (min) before auto-start:</span>
                            <input
                              type="number"
                              className="text-input number-input kick-group-options-input"
                              value={kickPollChatIdleMinutes}
                              onChange={(e) => setKickPollChatIdleMinutes(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 5)))}
                              min={1}
                              max={30}
                              style={{ width: 52 }}
                              onBlur={async () => {
                                try {
                                  await authenticatedFetch('/api/kick-poll-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ chatIdleMinutes: kickPollChatIdleMinutes }),
                                  });
                                  setToast({ type: 'saved', message: 'Saved!' });
                                } catch { /* ignore */ }
                                setTimeout(() => setToast(null), 2000);
                              }}
                            />
                          </label>
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

            </>
          )}
          
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