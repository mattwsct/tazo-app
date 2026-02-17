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
import type { KickMessageTemplates, KickMessageEnabled } from '@/types/kick-messages';
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
  host: 'Host',
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

  // Todo editing state
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');

  // Kick bot state
  const [kickStatus, setKickStatus] = useState<{ connected: boolean; subscriptions?: unknown[] } | null>(null);
  const [kickMessages, setKickMessages] = useState<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const [kickMessageEnabled, setKickMessageEnabled] = useState<KickMessageEnabled>(DEFAULT_KICK_MESSAGE_ENABLED);
  const [kickMinimumKicks, setKickMinimumKicks] = useState(0);
  const [kickGiftSubShowLifetimeSubs, setKickGiftSubShowLifetimeSubs] = useState(true);
  const [kickChatBroadcastLocation, setKickChatBroadcastLocation] = useState(false);
  const [kickChatBroadcastLocationInterval, setKickChatBroadcastLocationInterval] = useState(5);
  const [kickChatBroadcastHeartrate, setKickChatBroadcastHeartrate] = useState(false);
  const [kickChatBroadcastHeartrateMinBpm, setKickChatBroadcastHeartrateMinBpm] = useState(100);
  const [kickChatBroadcastHeartrateVeryHighBpm, setKickChatBroadcastHeartrateVeryHighBpm] = useState(120);
  const [kickTestMessage, setKickTestMessage] = useState('');
  const [kickTestSending, setKickTestSending] = useState(false);
  const [kickTemplateTesting, setKickTemplateTesting] = useState<keyof KickMessageTemplates | null>(null);
  const [kickBroadcastStatus, setKickBroadcastStatus] = useState<{
    heartRate?: { currentBpm: number; age: string; hasData: boolean; state: string; reason: string; wouldSendMessage: boolean; lastSentAt: string | null; lastSentAgo: string | null };
    kick?: { hasTokens: boolean };
    cron?: { runsEvery: string; note: string };
  } | null>(null);
  const [kickStreamTitleCustom, setKickStreamTitleCustom] = useState('');
  const [kickStreamTitleLocationDisplay, setKickStreamTitleLocationDisplay] = useState<StreamTitleLocationDisplay>('state');
  const [kickStreamTitleAutoUpdate, setKickStreamTitleAutoUpdate] = useState(true);
  const [kickStreamTitleLocation, setKickStreamTitleLocation] = useState<string>('');
  const [kickStreamTitleRawLocation, setKickStreamTitleRawLocation] = useState<LocationData | null>(null);
  const [kickStreamTitleLoading, setKickStreamTitleLoading] = useState(false);
  const [kickStreamTitleSaving, setKickStreamTitleSaving] = useState(false);
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
        if (d.alertSettings?.minimumKicks != null) setKickMinimumKicks(d.alertSettings.minimumKicks);
        if (d.alertSettings?.giftSubShowLifetimeSubs !== undefined) setKickGiftSubShowLifetimeSubs(d.alertSettings.giftSubShowLifetimeSubs);
        if (d.alertSettings?.chatBroadcastLocation !== undefined) setKickChatBroadcastLocation(d.alertSettings.chatBroadcastLocation);
        if (d.alertSettings?.chatBroadcastLocationIntervalMin != null) setKickChatBroadcastLocationInterval(d.alertSettings.chatBroadcastLocationIntervalMin);
        if (d.alertSettings?.chatBroadcastHeartrate !== undefined) setKickChatBroadcastHeartrate(d.alertSettings.chatBroadcastHeartrate);
        if (d.alertSettings?.chatBroadcastHeartrateMinBpm != null) setKickChatBroadcastHeartrateMinBpm(d.alertSettings.chatBroadcastHeartrateMinBpm);
        if (d.alertSettings?.chatBroadcastHeartrateVeryHighBpm != null) setKickChatBroadcastHeartrateVeryHighBpm(d.alertSettings.chatBroadcastHeartrateVeryHighBpm);
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

  const handleKickToggleChange = useCallback(
    async (key: keyof KickMessageEnabled, value: boolean) => {
      const next = { ...kickMessageEnabled, [key]: value };
      setKickMessageEnabled(next);
      setToast({ type: 'saving', message: 'Saving...' });
      try {
        const r = await authenticatedFetch('/api/kick-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        });
        if (r.ok) {
          setToast({ type: 'saved', message: 'Saved!' });
        } else {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to save');
        }
      } catch (err) {
        setKickMessageEnabled((prev) => ({ ...prev, [key]: !value }));
        setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
      setTimeout(() => setToast(null), 3000);
    },
    [kickMessageEnabled]
  );

  const lastPushedLocationRef = useRef<string | null>(null);
  const kickStreamTitleCustomRef = useRef(kickStreamTitleCustom);
  const kickStreamTitleLocationDisplayRef = useRef(kickStreamTitleLocationDisplay);
  kickStreamTitleCustomRef.current = kickStreamTitleCustom;
  kickStreamTitleLocationDisplayRef.current = kickStreamTitleLocationDisplay;

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
      const newFullTitle = buildStreamTitle(custom, formatted);
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
    const fullTitle = buildStreamTitle(kickStreamTitleCustom, kickStreamTitleLocation || '');
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
  }, [kickStatus?.connected, kickStreamTitleCustom, kickStreamTitleLocation, kickStreamTitleLocationDisplay, kickStreamTitleAutoUpdate]);

  const saveKickMessages = useCallback(async (overrides?: {
    messages?: KickMessageTemplates;
    enabled?: KickMessageEnabled;
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
        body: JSON.stringify({ messages, enabled, alertSettings }),
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
  }, [kickMessages, kickMessageEnabled, kickMinimumKicks, kickGiftSubShowLifetimeSubs, kickChatBroadcastLocation, kickChatBroadcastLocationInterval, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm]);

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

  const scheduleKickMessagesSave = useCallback(() => {
    if (kickMessagesSaveTimeoutRef.current) clearTimeout(kickMessagesSaveTimeoutRef.current);
    kickMessagesSaveTimeoutRef.current = setTimeout(() => {
      kickMessagesSaveTimeoutRef.current = null;
      saveKickMessages({
        messages: kickMessagesRef.current,
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

  const sendKickTestMessage = useCallback(async () => {
    if (!kickTestMessage.trim()) return;
    setKickTestSending(true);
    try {
      const r = await authenticatedFetch('/api/kick-messages/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: kickTestMessage.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setToast({ type: 'saved', message: 'Test sent!' });
        setKickTestMessage('');
      } else {
        throw new Error(data.error ?? 'Failed to send');
      }
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send' });
    }
    setTimeout(() => setToast(null), 3000);
    setKickTestSending(false);
  }, [kickTestMessage]);

  const sendKickTemplateTest = useCallback(
    async (key: keyof KickMessageTemplates) => {
      setKickTemplateTesting(key);
      try {
        const r = await authenticatedFetch('/api/kick-messages/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateKey: key,
            templates: kickMessages,
            alertSettings: { giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs },
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          setToast({ type: 'saved', message: 'Test sent!' });
        } else {
          throw new Error(data.error ?? 'Failed to send');
        }
      } catch (err) {
        setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send' });
      }
      setTimeout(() => setToast(null), 3000);
      setKickTemplateTesting(null);
    },
    [kickMessages, kickGiftSubShowLifetimeSubs]
  );

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

              {/* Test Message */}
              <section className="settings-section">
                <div className="section-header">
                  <h2>💬 Test message</h2>
                </div>
                <div className="setting-group">
                  <p className="group-label group-description group-description-sm">
                    Send a message to kick.com/tazo chat to test the bot.
                  </p>
                <div className="kick-test-row">
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Type a message..."
                    value={kickTestMessage}
                    onChange={(e) => setKickTestMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendKickTestMessage()}
                    maxLength={500}
                    disabled={!kickStatus?.connected}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={sendKickTestMessage}
                    disabled={!kickStatus?.connected || !kickTestMessage.trim() || kickTestSending}
                  >
                    {kickTestSending ? 'Sending...' : 'Send'}
                  </button>
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
                    Enable each event type and edit templates. Placeholders: {'{name}'}, {'{gifter}'}, {'{months}'}, {'{count}'}, {'{lifetimeSubs}'}, {'{sender}'}, {'{amount}'}, {'{kickDescription}'}, {'{redeemer}'}, {'{title}'}, {'{userInput}'}, {'{message}'}, {'{host}'}, {'{viewers}'}.
                  </p>
                <div className="form-stack">
                  {TEMPLATE_GROUP_CONFIG.map((group) => {
                    const isSingleTemplate = group.templateKeys.length === 1;
                    const toggleControl = (
                      <label className="checkbox-label-row kick-event-toggle">
                        <input
                          type="checkbox"
                          checked={kickMessageEnabled[group.toggleKey] !== false}
                          onChange={(e) => handleKickToggleChange(group.toggleKey, e.target.checked)}
                          className="checkbox-input"
                        />
                        <span className="radio-icon" aria-hidden="true">{TEMPLATE_GROUP_ICONS[group.toggleKey]}</span>
                        <strong className="kick-event-label">{group.label}</strong>
                      </label>
                    );
                    return (
                      <div key={group.toggleKey} className={`kick-message-group kick-message-card ${kickMessageEnabled[group.toggleKey] === false ? 'kick-message-card-disabled' : ''}`}>
                        {isSingleTemplate ? (
                          <div className="kick-message-row kick-message-template-row kick-message-row-with-toggle">
                            {toggleControl}
                            <input
                              type="text"
                              className="text-input"
                              value={kickMessages[group.templateKeys[0]]}
                              onChange={(e) => handleKickMessageChange(group.templateKeys[0], e.target.value)}
                              placeholder={DEFAULT_KICK_MESSAGES[group.templateKeys[0]]}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary kick-test-btn btn-small"
                              onClick={() => sendKickTemplateTest(group.templateKeys[0])}
                              disabled={!kickStatus?.connected || kickTemplateTesting === group.templateKeys[0]}
                              title="Send test to Kick chat"
                            >
                              {kickTemplateTesting === group.templateKeys[0] ? '…' : 'Test'}
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="form-row-wrap group-header-row">
                              {toggleControl}
                              {group.toggleKey === 'giftSub' && (
                                <label className="checkbox-label-row">
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
                                  <span>Show lifetime subs</span>
                                </label>
                              )}
                              {group.toggleKey === 'kicksGifted' && (
                                <label className="checkbox-label-row-tight">
                                  Min kicks:
                                  <input
                                    type="number"
                                    className="text-input number-input"
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
                            {group.templateKeys.map((key) => (
                              <div key={key} className="kick-message-row kick-message-template-row">
                                <span className="inline-label-muted kick-template-label">{KICK_MESSAGE_LABELS[key]}</span>
                                <input
                                  type="text"
                                  className="text-input"
                                  value={kickMessages[key]}
                                  onChange={(e) => handleKickMessageChange(key, e.target.value)}
                                  placeholder={DEFAULT_KICK_MESSAGES[key]}
                                />
                                <button
                                  type="button"
                                  className="btn btn-secondary kick-test-btn btn-small"
                                  onClick={() => sendKickTemplateTest(key)}
                                  disabled={!kickStatus?.connected || kickTemplateTesting === key}
                                  title="Send test to Kick chat"
                                >
                                  {kickTemplateTesting === key ? '…' : 'Test'}
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="section-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setKickMessages(DEFAULT_KICK_MESSAGES);
                      saveKickMessages({ messages: DEFAULT_KICK_MESSAGES });
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