"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import {
  DEFAULT_KICK_MESSAGES,
  TEMPLATE_GROUP_CONFIG,
  TEMPLATE_GROUP_ICONS,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled, KickMessageTemplateEnabled } from '@/types/kick-messages';
import { getLocationForStreamTitle, getStreamTitleLocationPart, parseStreamTitleToCustom, buildStreamTitle } from '@/utils/stream-title-utils';
import { formatLocation, type LocationData } from '@/utils/location-utils';
import '@/styles/admin.css';
import CollapsibleSection, { collapseAllSections } from '@/components/CollapsibleSection';

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
  const [leaderboardExcludedBotsInput, setLeaderboardExcludedBotsInput] = useState('');
  const leaderboardExcludedBotsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [subGoalTargetInput, setSubGoalTargetInput] = useState<string>('10');
  const [kicksGoalTargetInput, setKicksGoalTargetInput] = useState<string>('1000');
  const [subGoalIncrementInput, setSubGoalIncrementInput] = useState<string>('10');
  const [kicksGoalIncrementInput, setKicksGoalIncrementInput] = useState<string>('1000');
  const [subGoalSubtextInput, setSubGoalSubtextInput] = useState<string>('');
  const [kicksGoalSubtextInput, setKicksGoalSubtextInput] = useState<string>('');
  const [goalCelebrationDurationInput, setGoalCelebrationDurationInput] = useState<string>('15');
  const subGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalIncrementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalIncrementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const goalCelebrationDurationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kickMessagesSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kickMessagesRef = useRef<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const kickTemplateEnabledRef = useRef<KickMessageTemplateEnabled>({});

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
  const [kickChatBroadcastStreamTitle, setKickChatBroadcastStreamTitle] = useState(false);
  const [kickChatBroadcastLocation, setKickChatBroadcastLocation] = useState(false);
  const [kickChatBroadcastLocationIntervalMin, setKickChatBroadcastLocationIntervalMin] = useState(5);
  const [kickChatBroadcastWeather, setKickChatBroadcastWeather] = useState(false);
  const [kickChatBroadcastHeartrate, setKickChatBroadcastHeartrate] = useState(false);
  const [kickChatBroadcastHeartrateMinBpm, setKickChatBroadcastHeartrateMinBpm] = useState(100);
  const [kickChatBroadcastHeartrateVeryHighBpm, setKickChatBroadcastHeartrateVeryHighBpm] = useState(120);
  const [kickChatBroadcastSpeed, setKickChatBroadcastSpeed] = useState(false);
  const [kickChatBroadcastSpeedMinKmh, setKickChatBroadcastSpeedMinKmh] = useState(20);
  const [kickChatBroadcastSpeedTimeoutMin, setKickChatBroadcastSpeedTimeoutMin] = useState(5);
  const [kickChatBroadcastAltitude, setKickChatBroadcastAltitude] = useState(false);
  const [kickChatBroadcastAltitudeMinM, setKickChatBroadcastAltitudeMinM] = useState(50);
  const [kickChatBroadcastAltitudeTimeoutMin, setKickChatBroadcastAltitudeTimeoutMin] = useState(5);
  const [kickChatBroadcastWellnessSteps, setKickChatBroadcastWellnessSteps] = useState(true);
  const [kickChatBroadcastWellnessDistance, setKickChatBroadcastWellnessDistance] = useState(true);
  const [kickChatBroadcastWellnessFlights, setKickChatBroadcastWellnessFlights] = useState(false);
  const [kickChatBroadcastWellnessActiveCalories, setKickChatBroadcastWellnessActiveCalories] = useState(false);
  const [kickStreamTitleCustom, setKickStreamTitleCustom] = useState('');
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
  const [wellnessData, setWellnessData] = useState<Record<string, string | number | undefined>>({});
  const [wellnessLoading, setWellnessLoading] = useState(false);
  const [wellnessSaving, setWellnessSaving] = useState(false);
  const [kickPollOgsCanStart, setKickPollOgsCanStart] = useState(false);
  const [kickPollSubsCanStart, setKickPollSubsCanStart] = useState(false);
  const [kickPollMaxQueued, setKickPollMaxQueued] = useState(5);
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
        if (d.alertSettings?.chatBroadcastStreamTitle !== undefined) setKickChatBroadcastStreamTitle(d.alertSettings.chatBroadcastStreamTitle);
        if (d.alertSettings?.chatBroadcastLocation !== undefined) setKickChatBroadcastLocation(d.alertSettings.chatBroadcastLocation);
        if (d.alertSettings?.chatBroadcastLocationIntervalMin != null) setKickChatBroadcastLocationIntervalMin(d.alertSettings.chatBroadcastLocationIntervalMin);
        if (d.alertSettings?.chatBroadcastWeather !== undefined) setKickChatBroadcastWeather(d.alertSettings.chatBroadcastWeather);
        if (d.alertSettings?.chatBroadcastHeartrate !== undefined) setKickChatBroadcastHeartrate(d.alertSettings.chatBroadcastHeartrate);
        if (d.alertSettings?.chatBroadcastHeartrateMinBpm != null) setKickChatBroadcastHeartrateMinBpm(d.alertSettings.chatBroadcastHeartrateMinBpm);
        if (d.alertSettings?.chatBroadcastHeartrateVeryHighBpm != null) setKickChatBroadcastHeartrateVeryHighBpm(d.alertSettings.chatBroadcastHeartrateVeryHighBpm);
        if (d.alertSettings?.chatBroadcastSpeed !== undefined) setKickChatBroadcastSpeed(d.alertSettings.chatBroadcastSpeed);
        if (d.alertSettings?.chatBroadcastSpeedMinKmh != null) setKickChatBroadcastSpeedMinKmh(d.alertSettings.chatBroadcastSpeedMinKmh);
        if (d.alertSettings?.chatBroadcastSpeedTimeoutMin != null) setKickChatBroadcastSpeedTimeoutMin(d.alertSettings.chatBroadcastSpeedTimeoutMin);
        if (d.alertSettings?.chatBroadcastAltitude !== undefined) setKickChatBroadcastAltitude(d.alertSettings.chatBroadcastAltitude);
        if (d.alertSettings?.chatBroadcastAltitudeMinM != null) setKickChatBroadcastAltitudeMinM(d.alertSettings.chatBroadcastAltitudeMinM);
        if (d.alertSettings?.chatBroadcastAltitudeTimeoutMin != null) setKickChatBroadcastAltitudeTimeoutMin(d.alertSettings.chatBroadcastAltitudeTimeoutMin);
        if (d.alertSettings?.chatBroadcastWellnessSteps !== undefined) setKickChatBroadcastWellnessSteps(d.alertSettings.chatBroadcastWellnessSteps);
        if (d.alertSettings?.chatBroadcastWellnessDistance !== undefined) setKickChatBroadcastWellnessDistance(d.alertSettings.chatBroadcastWellnessDistance);
        if (d.alertSettings?.chatBroadcastWellnessFlights !== undefined) setKickChatBroadcastWellnessFlights(d.alertSettings.chatBroadcastWellnessFlights);
        if (d.alertSettings?.chatBroadcastWellnessActiveCalories !== undefined) setKickChatBroadcastWellnessActiveCalories(d.alertSettings.chatBroadcastWellnessActiveCalories);
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
        if (d?.oneVotePerPerson !== undefined) setKickPollOneVotePerPerson(d.oneVotePerPerson);
      })
      .catch(() => {});
    fetch('/api/kick-channel', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
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

  const kickStreamTitleCustomRef = useRef(kickStreamTitleCustom);
  const locationDisplayRef = useRef(settings.locationDisplay);
  const customLocationRef = useRef(settings.customLocation ?? '');
  const kickStreamTitleIncludeLocationRef = useRef(kickStreamTitleIncludeLocation);
  kickStreamTitleCustomRef.current = kickStreamTitleCustom;
  locationDisplayRef.current = settings.locationDisplay;
  customLocationRef.current = settings.customLocation ?? '';
  kickStreamTitleIncludeLocationRef.current = kickStreamTitleIncludeLocation;

  const fetchLocationData = useCallback(async () => {
    try {
      const locRes = await fetch('/api/location', { credentials: 'include' });
      const locData = await locRes.json();
      const raw = locData?.rawLocation ?? locData?.location;
      if (raw) {
        setKickStreamTitleRawLocation(raw);
        const loc = getLocationForStreamTitle(raw, locationDisplayRef.current, customLocationRef.current);
        setKickStreamTitleLocation(loc);
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

  useEffect(() => {
    fetchLocationData();
  }, [fetchLocationData]);

  useEffect(() => {
    const loc = getLocationForStreamTitle(kickStreamTitleRawLocation, settings.locationDisplay, settings.customLocation ?? '');
    setKickStreamTitleLocation(loc);
  }, [settings.locationDisplay, settings.customLocation, kickStreamTitleRawLocation]);

  const fetchKickStreamTitle = useCallback(async () => {
    setKickStreamTitleLoading(true);
    try {
      const r = await authenticatedFetch('/api/kick-channel');
      const data = await r.json();
      if (data.settings) {
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
    const locationPart = getStreamTitleLocationPart(
      kickStreamTitleRawLocation,
      settings.locationDisplay,
      settings.customLocation ?? '',
      kickStreamTitleIncludeLocation
    );
    const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart);
    try {
      const r = await authenticatedFetch('/api/kick-channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_title: fullTitle.trim(),
          settings: {
            customTitle: kickStreamTitleCustom,
            includeLocationInTitle: kickStreamTitleIncludeLocation,
          },
        }),
      });
      const data = await r.json();
      if (r.ok) {
        setToast({ type: 'saved', message: 'Saved!' });
      } else {
        setToast({ type: 'error', message: data.error ?? 'Failed to update' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to update stream title' });
    }
    setKickStreamTitleSaving(false);
    setTimeout(() => setToast(null), 3000);
  }, [kickStatus?.connected, kickStreamTitleCustom, kickStreamTitleRawLocation, kickStreamTitleIncludeLocation, settings.locationDisplay, settings.customLocation]);

  const saveKickMessages = useCallback(async (overrides?: {
    messages?: KickMessageTemplates;
    enabled?: KickMessageEnabled;
    templateEnabled?: KickMessageTemplateEnabled;
    alertSettings?: Partial<{
      minimumKicks: number;
      chatBroadcastStreamTitle: boolean;
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
      chatBroadcastWellnessSteps: boolean;
      chatBroadcastWellnessDistance: boolean;
      chatBroadcastWellnessFlights: boolean;
      chatBroadcastWellnessActiveCalories: boolean;
    }>;
  }) => {
    const messages = overrides?.messages ?? kickMessages;
    const enabled = overrides?.enabled ?? kickMessageEnabled;
    const templateEnabled = overrides?.templateEnabled ?? kickTemplateEnabled;
    const alertSettings = overrides?.alertSettings ?? {
      minimumKicks: kickMinimumKicks,
      chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
      chatBroadcastLocation: kickChatBroadcastLocation,
      chatBroadcastLocationIntervalMin: kickChatBroadcastLocationIntervalMin,
      chatBroadcastWeather: kickChatBroadcastWeather,
      chatBroadcastHeartrate: kickChatBroadcastHeartrate,
      chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
      chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
      chatBroadcastSpeed: kickChatBroadcastSpeed,
      chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
      chatBroadcastSpeedTimeoutMin: kickChatBroadcastSpeedTimeoutMin,
      chatBroadcastAltitude: kickChatBroadcastAltitude,
      chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
      chatBroadcastAltitudeTimeoutMin: kickChatBroadcastAltitudeTimeoutMin,
      chatBroadcastWellnessSteps: kickChatBroadcastWellnessSteps,
      chatBroadcastWellnessDistance: kickChatBroadcastWellnessDistance,
      chatBroadcastWellnessFlights: kickChatBroadcastWellnessFlights,
      chatBroadcastWellnessActiveCalories: kickChatBroadcastWellnessActiveCalories,
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
  }, [kickMessages, kickMessageEnabled, kickTemplateEnabled, kickMinimumKicks, kickChatBroadcastStreamTitle, kickChatBroadcastLocation, kickChatBroadcastLocationIntervalMin, kickChatBroadcastWeather, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm, kickChatBroadcastSpeed, kickChatBroadcastSpeedMinKmh, kickChatBroadcastSpeedTimeoutMin, kickChatBroadcastAltitude, kickChatBroadcastAltitudeMinM, kickChatBroadcastAltitudeTimeoutMin, kickChatBroadcastWellnessSteps, kickChatBroadcastWellnessDistance, kickChatBroadcastWellnessFlights, kickChatBroadcastWellnessActiveCalories]);

  const kickAlertSettingsRef = useRef({
    minimumKicks: kickMinimumKicks,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: kickChatBroadcastLocationIntervalMin,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
    chatBroadcastSpeed: kickChatBroadcastSpeed,
    chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
    chatBroadcastSpeedTimeoutMin: kickChatBroadcastSpeedTimeoutMin,
    chatBroadcastAltitude: kickChatBroadcastAltitude,
    chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
    chatBroadcastAltitudeTimeoutMin: kickChatBroadcastAltitudeTimeoutMin,
    chatBroadcastWeather: kickChatBroadcastWeather,
    chatBroadcastWellnessSteps: kickChatBroadcastWellnessSteps,
    chatBroadcastWellnessDistance: kickChatBroadcastWellnessDistance,
    chatBroadcastWellnessActiveCalories: kickChatBroadcastWellnessActiveCalories,
  });
  kickAlertSettingsRef.current = {
    minimumKicks: kickMinimumKicks,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
    chatBroadcastLocation: kickChatBroadcastLocation,
    chatBroadcastLocationIntervalMin: kickChatBroadcastLocationIntervalMin,
    chatBroadcastHeartrate: kickChatBroadcastHeartrate,
    chatBroadcastHeartrateMinBpm: kickChatBroadcastHeartrateMinBpm,
    chatBroadcastHeartrateVeryHighBpm: kickChatBroadcastHeartrateVeryHighBpm,
    chatBroadcastSpeed: kickChatBroadcastSpeed,
    chatBroadcastSpeedMinKmh: kickChatBroadcastSpeedMinKmh,
    chatBroadcastSpeedTimeoutMin: kickChatBroadcastSpeedTimeoutMin,
    chatBroadcastAltitude: kickChatBroadcastAltitude,
    chatBroadcastAltitudeMinM: kickChatBroadcastAltitudeMinM,
    chatBroadcastAltitudeTimeoutMin: kickChatBroadcastAltitudeTimeoutMin,
    chatBroadcastWeather: kickChatBroadcastWeather,
    chatBroadcastWellnessSteps: kickChatBroadcastWellnessSteps,
    chatBroadcastWellnessDistance: kickChatBroadcastWellnessDistance,
    chatBroadcastWellnessActiveCalories: kickChatBroadcastWellnessActiveCalories,
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

  // Debounced leaderboard excluded bots (saves after 1s of no typing)
  const handleLeaderboardExcludedBotsChange = useCallback((value: string) => {
    setLeaderboardExcludedBotsInput(value);
    if (leaderboardExcludedBotsTimeoutRef.current) clearTimeout(leaderboardExcludedBotsTimeoutRef.current);
    leaderboardExcludedBotsTimeoutRef.current = setTimeout(() => {
      handleSettingsChange({ leaderboardExcludedBots: value });
    }, 1000);
  }, [handleSettingsChange]);

  useEffect(() => {
    setLeaderboardExcludedBotsInput(settings.leaderboardExcludedBots ?? '');
  }, [settings.leaderboardExcludedBots]);

  useEffect(() => {
    return () => {
      if (leaderboardExcludedBotsTimeoutRef.current) clearTimeout(leaderboardExcludedBotsTimeoutRef.current);
    };
  }, []);

  // Sync sub/kicks goal target, increment, and subtext inputs from settings
  useEffect(() => {
    setSubGoalTargetInput(String(settings.subGoalTarget ?? 10));
    setKicksGoalTargetInput(String(settings.kicksGoalTarget ?? 1000));
    setSubGoalIncrementInput(String(settings.subGoalIncrement ?? 10));
    setKicksGoalIncrementInput(String(settings.kicksGoalIncrement ?? 1000));
    setSubGoalSubtextInput(settings.subGoalSubtext ?? '');
    setKicksGoalSubtextInput(settings.kicksGoalSubtext ?? '');
    setGoalCelebrationDurationInput(String(settings.goalCelebrationDurationSec ?? 15));
  }, [settings.subGoalTarget, settings.kicksGoalTarget, settings.subGoalIncrement, settings.kicksGoalIncrement, settings.subGoalSubtext, settings.kicksGoalSubtext, settings.goalCelebrationDurationSec]);

  // Debounced handlers for number inputs (1s delay before saving)
  const handleSubGoalTargetChange = useCallback((value: string) => {
    setSubGoalTargetInput(value);
    if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
    subGoalTargetTimeoutRef.current = setTimeout(() => {
      subGoalTargetTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      handleSettingsChange({ subGoalTarget: n });
    }, 1000);
  }, [handleSettingsChange]);

  const handleKicksGoalTargetChange = useCallback((value: string) => {
    setKicksGoalTargetInput(value);
    if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
    kicksGoalTargetTimeoutRef.current = setTimeout(() => {
      kicksGoalTargetTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      handleSettingsChange({ kicksGoalTarget: n });
    }, 1000);
  }, [handleSettingsChange]);

  const handleSubGoalIncrementChange = useCallback((value: string) => {
    setSubGoalIncrementInput(value);
    if (subGoalIncrementTimeoutRef.current) clearTimeout(subGoalIncrementTimeoutRef.current);
    subGoalIncrementTimeoutRef.current = setTimeout(() => {
      subGoalIncrementTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      handleSettingsChange({ subGoalIncrement: n });
    }, 1000);
  }, [handleSettingsChange]);

  const handleKicksGoalIncrementChange = useCallback((value: string) => {
    setKicksGoalIncrementInput(value);
    if (kicksGoalIncrementTimeoutRef.current) clearTimeout(kicksGoalIncrementTimeoutRef.current);
    kicksGoalIncrementTimeoutRef.current = setTimeout(() => {
      kicksGoalIncrementTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      handleSettingsChange({ kicksGoalIncrement: n });
    }, 1000);
  }, [handleSettingsChange]);

  const handleSubGoalSubtextChange = useCallback((value: string) => {
    setSubGoalSubtextInput(value);
    if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
    subGoalSubtextTimeoutRef.current = setTimeout(() => {
      subGoalSubtextTimeoutRef.current = null;
      handleSettingsChange({ subGoalSubtext: value.trim() || undefined });
    }, 1000);
  }, [handleSettingsChange]);

  const handleKicksGoalSubtextChange = useCallback((value: string) => {
    setKicksGoalSubtextInput(value);
    if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
    kicksGoalSubtextTimeoutRef.current = setTimeout(() => {
      kicksGoalSubtextTimeoutRef.current = null;
      handleSettingsChange({ kicksGoalSubtext: value.trim() || undefined });
    }, 1000);
  }, [handleSettingsChange]);

  const handleGoalCelebrationDurationChange = useCallback((value: string) => {
    setGoalCelebrationDurationInput(value);
    if (goalCelebrationDurationTimeoutRef.current) clearTimeout(goalCelebrationDurationTimeoutRef.current);
    goalCelebrationDurationTimeoutRef.current = setTimeout(() => {
      goalCelebrationDurationTimeoutRef.current = null;
      const n = Math.max(1, Math.min(300, parseInt(value, 10) || 15));
      handleSettingsChange({ goalCelebrationDurationSec: n });
    }, 1000);
  }, [handleSettingsChange]);

  useEffect(() => {
    return () => {
      if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
      if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
      if (subGoalIncrementTimeoutRef.current) clearTimeout(subGoalIncrementTimeoutRef.current);
      if (kicksGoalIncrementTimeoutRef.current) clearTimeout(kicksGoalIncrementTimeoutRef.current);
      if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
      if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
      if (goalCelebrationDurationTimeoutRef.current) clearTimeout(goalCelebrationDurationTimeoutRef.current);
    };
  }, []);

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
      const res = await authenticatedFetch('/api/location/browser', {
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
          <div className="collapse-all-row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => collapseAllSections(true)}>
              Collapse all
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => collapseAllSections(false)}>
              Expand all
            </button>
            </div>
            
          {/* Setup: Kick connection — connect first before stream title, poll, messages */}
          <CollapsibleSection id="connection" title="🔗 Kick connection">
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
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleKickOAuthConnect}>
                        🔄 Reconnect
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          if (!confirm('Disconnect Kick?')) return;
                          try {
                            const r = await fetch('/api/kick-oauth/disconnect', { method: 'POST', credentials: 'include' });
                            if (r.ok) { setKickStatus({ connected: false }); setToast({ type: 'saved', message: 'Disconnected' }); }
                            else { const d = await r.json(); setToast({ type: 'error', message: d.error ?? 'Failed' }); }
                          } catch { setToast({ type: 'error', message: 'Failed' }); }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="kick-status disconnected">
                    <span className="status-dot">🔴</span>
                    <span>Not connected</span>
                    <button style={{ marginTop: 8 }}
                      type="button"
                      className="btn btn-primary"
                      onClick={handleKickOAuthConnect}
                    >
                      Connect Kick
                    </button>
                  </div>
                )}
              </div>
          </CollapsibleSection>

          {/* Location & map — overlay display, stored location, map */}
          <CollapsibleSection id="location-map" title="📍 Location & map">
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
                <label>Location — overlay, chat (!location), stream title, minimap</label>
                <div className="option-buttons" role="group" aria-label="Location display">
                  {(['city', 'state', 'country', 'custom', 'hidden'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`option-btn ${settings.locationDisplay === mode ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ locationDisplay: mode })}
                    >
                      {mode === 'city' && '🏙️ City'}
                      {mode === 'state' && '🗺️ State'}
                      {mode === 'country' && '🌍 Country'}
                      {mode === 'custom' && '✏️ Custom'}
                      {mode === 'hidden' && '🚫 Hidden'}
                    </button>
                  ))}
                </div>
              </div>
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
            </div>
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <label className="group-label">Map</label>
              <div className="admin-select-wrap" style={{ opacity: settings.locationDisplay === 'hidden' ? 0.6 : 1 }}>
                <div className="option-buttons" role="group" aria-label="Map display">
                  <button
                    type="button"
                    className={`option-btn ${settings.showMinimap ? 'active' : ''}`}
                    onClick={() => handleSettingsChange({ showMinimap: true, minimapSpeedBased: false })}
                    disabled={settings.locationDisplay === 'hidden'}
                  >
                    👁️ Always
                  </button>
                  <button
                    type="button"
                    className={`option-btn ${settings.minimapSpeedBased ? 'active' : ''}`}
                    onClick={() => handleSettingsChange({ showMinimap: false, minimapSpeedBased: true })}
                    disabled={settings.locationDisplay === 'hidden'}
                  >
                    🏃 When moving (≥5 km/h)
                  </button>
                  <button
                    type="button"
                    className={`option-btn ${!settings.showMinimap && !settings.minimapSpeedBased ? 'active' : ''}`}
                    onClick={() => handleSettingsChange({ showMinimap: false, minimapSpeedBased: false })}
                    disabled={settings.locationDisplay === 'hidden'}
                  >
                    🚫 Hidden
                  </button>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Stream title */}
          <CollapsibleSection id="stream-title" title="📺 Stream title">
            <div className="setting-group">
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
                <label className="checkbox-label-row" style={{ marginTop: '12px' }}>
                  <input
                    type="checkbox"
                    checked={kickStreamTitleIncludeLocation}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setKickStreamTitleIncludeLocation(checked);
                      if (kickStatus?.connected) {
                        const locationPart = getStreamTitleLocationPart(
                          kickStreamTitleRawLocation,
                          settings.locationDisplay,
                          settings.customLocation ?? '',
                          checked
                        );
                        const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart);
                        try {
                          const r = await authenticatedFetch('/api/kick-channel', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              stream_title: fullTitle.trim(),
                              settings: {
                                customTitle: kickStreamTitleCustom,
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
                  Include location in stream title
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
            
          </CollapsibleSection>

          {/* === OVERLAY === */}
          <CollapsibleSection id="overlay" title="🖥️ Overlay display">
            <h3 className="subsection-label" style={{ marginBottom: 8 }}>Top-left &amp; top-right rotation</h3>
            <div className="setting-group">
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Top-left (wellness — Health Auto Export)</h4>
              <div className="checkbox-group" style={{ marginBottom: 8 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showSteps ?? true}
                    onChange={(e) => handleSettingsChange({ showSteps: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Steps — from Health Auto Export</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showDistance ?? true}
                    onChange={(e) => handleSettingsChange({ showDistance: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Distance — when walking/running detected</span>
                </label>
            </div>
            </div>
            
            <div className="setting-group" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Top-right (location data)</h4>
              <div className="checkbox-group" style={{ marginBottom: 8 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showWeather ?? false}
                    onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Weather — temp &amp; conditions from GPS location</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showAltitude ?? true}
                    onChange={(e) => handleSettingsChange({ showAltitude: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Altitude — shows when ≥50m change from session start</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showSpeed ?? true}
                    onChange={(e) => handleSettingsChange({ showSpeed: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Speed — shows when ≥10 km/h</span>
                </label>
              </div>
            </div>

            <div className="setting-separator" style={{ margin: '1.25rem 0' }} />

            <h3 className="subsection-label" style={{ marginBottom: 8 }}>Bottom-right rotation &amp; alerts</h3>
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showGoalsRotation !== false}
                    onChange={(e) => handleSettingsChange({ showGoalsRotation: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show rotating section (leaderboard, goals, poll)</span>
                </label>
              </div>
              <div className="checkbox-group" style={{ marginTop: '8px', marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showOverlayAlerts ?? true}
                    onChange={(e) => handleSettingsChange({ showOverlayAlerts: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show overlay alerts (subs, gifts, kicks)</span>
                </label>
              </div>
              <div className="button-row" style={{ marginTop: '12px' }}>
                <span className="group-label" style={{ marginRight: '8px' }}>Test alert:</span>
                {(['sub', 'resub', 'giftSub', 'kicks'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      try {
                        const res = await authenticatedFetch('/api/overlay-alerts/test', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ type }),
                        });
                        if (res.ok) setToast({ type: 'saved', message: `Test ${type} alert sent` });
                        else setToast({ type: 'error', message: 'Test failed' });
                      } catch {
                        setToast({ type: 'error', message: 'Test failed' });
                      }
                    }}
                  >
                    {type === 'sub' && '🎉 Sub'}
                    {type === 'resub' && '💪 Resub'}
                    {type === 'giftSub' && '🎁 Gift'}
                    {type === 'kicks' && '💰 Kicks'}
                  </button>
                ))}
              </div>
            </div>
          </CollapsibleSection>

          {/* === GAMBLING & EVENTS === */}
          <CollapsibleSection id="gambling" title="🎰 Gambling & events">
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.gamblingEnabled !== false}
                    onChange={(e) => handleSettingsChange({ gamblingEnabled: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Enable gambling</span>
                </label>
              </div>
              {settings.gamblingEnabled !== false && (
                <>
                  <div className="admin-select-wrap" style={{ marginBottom: '12px' }}>
                    <label>Tazos leaderboard</label>
                    <select
                      className="admin-select-big"
                      value={settings.showLeaderboard !== false ? 'true' : 'false'}
                      onChange={(e) => handleSettingsChange({ showLeaderboard: e.target.value === 'true' })}
                    >
                      <option value="true">🃏 Show in rotation</option>
                      <option value="false">🚫 Hidden</option>
                    </select>
                  </div>
                  {settings.showLeaderboard !== false && (
                    <div className="admin-select-wrap">
                      <label>Top N tazos</label>
                      <select
                        className="admin-select-big"
                        value={settings.gamblingLeaderboardTopN ?? settings.leaderboardTopN ?? 5}
                        onChange={(e) => handleSettingsChange({ gamblingLeaderboardTopN: Number(e.target.value) })}
                      >
                        {[1, 3, 5, 10].map((n) => (
                          <option key={n} value={n}>Top {n}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="admin-select-wrap">
                    <label>Excluded users (comma separated)</label>
                    <textarea
                      className="text-input"
                      value={leaderboardExcludedBotsInput}
                      onChange={(e) => handleLeaderboardExcludedBotsChange(e.target.value)}
                      placeholder="e.g. nightbot, moobot, streamelements"
                      rows={2}
                      style={{ resize: 'vertical', minHeight: 50 }}
                    />
                  </div>
                  <div className="admin-select-wrap" style={{ marginTop: '12px' }}>
                    <label>Channel point reward name (redeem for tazos)</label>
                    <input
                      type="text"
                      className="text-input"
                      value={settings.chipRewardTitle ?? 'Buy Tazos'}
                      onChange={(e) => handleSettingsChange({ chipRewardTitle: e.target.value })}
                      placeholder="Buy Tazos"
                    />
                  </div>
                  <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                    <label>Tazos per redemption</label>
                    <input
                      type="number"
                      className="text-input"
                      value={settings.chipRewardChips ?? 50}
                      onChange={(e) => handleSettingsChange({ chipRewardChips: Math.max(1, parseInt(e.target.value, 10) || 50) })}
                      min={1}
                    />
                  </div>

                  <div className="setting-separator" style={{ margin: '1rem 0' }} />
                  <h4 className="subsection-label" style={{ marginBottom: 8 }}>Automated events</h4>
                  <div className="checkbox-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.autoRaffleEnabled !== false} onChange={(e) => handleSettingsChange({ autoRaffleEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Auto-raffle every ~30 min when live</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.chipDropsEnabled !== false} onChange={(e) => handleSettingsChange({ chipDropsEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Tazo drops every ~15 min</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.chatChallengesEnabled !== false} onChange={(e) => handleSettingsChange({ chatChallengesEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Chat challenges every ~20-30 min</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.bossEventsEnabled !== false} onChange={(e) => handleSettingsChange({ bossEventsEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Boss events every ~45-60 min</span>
                    </label>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('Reset event timestamps? Use if drops/raffles/challenges aren\'t starting. They\'ll be eligible to start again on next cron run.')) return;
                        try {
                          const r = await authenticatedFetch('/api/reset-event-timestamps', { method: 'POST' });
                          const data = await r.json();
                          if (r.ok) setToast({ type: 'saved', message: 'Event timestamps reset — events can start again' });
                          else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                        } catch { setToast({ type: 'error', message: 'Reset failed' }); }
                        setTimeout(() => setToast(null), 3000);
                      }}
                      className="button-secondary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      Reset event timestamps
                    </button>
                  </div>

                  <div className="setting-separator" style={{ margin: '1rem 0' }} />
                  <h4 className="subsection-label" style={{ marginBottom: 8 }}>Bonus rewards</h4>
                  <div className="checkbox-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.winStreaksEnabled !== false} onChange={(e) => handleSettingsChange({ winStreaksEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Win streak bonuses</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.participationStreaksEnabled !== false} onChange={(e) => handleSettingsChange({ participationStreaksEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Participation streak rewards</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.subGiftChipRewards !== false} onChange={(e) => handleSettingsChange({ subGiftChipRewards: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">Tazo rewards for subs/gifts/kicks</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* === CHAT COMMANDS === */}
          <CollapsibleSection id="chat-commands" title="💬 Chat commands">
            <div className="setting-group">
              {settings.gamblingEnabled !== false && (
                <>
                  <h4 className="subsection-label" style={{ marginBottom: 8 }}>Games</h4>
                  <div className="checkbox-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.coinflipEnabled !== false} onChange={(e) => handleSettingsChange({ coinflipEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!gamble — coin flip (50/50)</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.blackjackEnabled !== false} onChange={(e) => handleSettingsChange({ blackjackEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!deal — blackjack</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.slotsEnabled !== false} onChange={(e) => handleSettingsChange({ slotsEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!slots — slot machine</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.rouletteEnabled !== false} onChange={(e) => handleSettingsChange({ rouletteEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!roulette — red/black/number</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.diceEnabled !== false} onChange={(e) => handleSettingsChange({ diceEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!dice — high/low roll</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.crashEnabled !== false} onChange={(e) => handleSettingsChange({ crashEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!crash — cash out before crash</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.warEnabled !== false} onChange={(e) => handleSettingsChange({ warEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!war — card war</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.duelEnabled !== false} onChange={(e) => handleSettingsChange({ duelEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!duel — challenge another player</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.heistEnabled !== false} onChange={(e) => handleSettingsChange({ heistEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!heist — group heist</span>
                    </label>
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.giftEnabled !== false} onChange={(e) => handleSettingsChange({ giftEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!gift / !ask / !beg — tazo transfers</span>
                    </label>
                  </div>
                  <div className="setting-separator" style={{ margin: '1rem 0' }} />
                </>
              )}
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Utility commands</h4>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={settings.convertEnabled !== false} onChange={(e) => handleSettingsChange({ convertEnabled: e.target.checked })} className="checkbox-input" />
                  <span className="checkbox-text">!convert — currency &amp; unit conversion</span>
                </label>
              </div>
              <div className="checkbox-group" style={{ marginTop: '4px' }}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={settings.mathEnabled !== false} onChange={(e) => handleSettingsChange({ mathEnabled: e.target.checked })} className="checkbox-input" />
                  <span className="checkbox-text">!math — calculator</span>
                </label>
              </div>
            </div>
          </CollapsibleSection>

          {/* === STREAM GOALS === */}
          <CollapsibleSection id="stream-goals" title="🎯 Stream goals">
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showSubGoal ?? false}
                    onChange={(e) => handleSettingsChange({ showSubGoal: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Sub goal — include in rotation</span>
                </label>
                {settings.showSubGoal && (
                  <div style={{ marginLeft: '24px', marginTop: 8 }}>
                    <div className="admin-select-wrap">
                      <label>Sub goal target</label>
                      <input type="number" className="text-input" value={subGoalTargetInput} onChange={(e) => handleSubGoalTargetChange(e.target.value)} min={1} />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Auto-increment amount (when goal is reached)</label>
                      <input type="number" className="text-input" value={subGoalIncrementInput} onChange={(e) => handleSubGoalIncrementChange(e.target.value)} min={1} />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Sub goal subtext (optional second line)</label>
                      <input type="text" className="text-input" value={subGoalSubtextInput} onChange={(e) => handleSubGoalSubtextChange(e.target.value)} placeholder="e.g. 10 subs = 10 min extra stream" />
                    </div>
                  </div>
                )}
                <label className="checkbox-label" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.showKicksGoal ?? false}
                    onChange={(e) => handleSettingsChange({ showKicksGoal: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Kicks goal — include in rotation</span>
                </label>
                {settings.showKicksGoal && (
                  <div style={{ marginLeft: '24px', marginTop: 8 }}>
                    <div className="admin-select-wrap">
                      <label>Kicks goal target</label>
                      <input type="number" className="text-input" value={kicksGoalTargetInput} onChange={(e) => handleKicksGoalTargetChange(e.target.value)} min={1} />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Auto-increment amount (when goal is reached)</label>
                      <input type="number" className="text-input" value={kicksGoalIncrementInput} onChange={(e) => handleKicksGoalIncrementChange(e.target.value)} min={1} />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Kicks goal subtext (optional second line)</label>
                      <input type="text" className="text-input" value={kicksGoalSubtextInput} onChange={(e) => handleKicksGoalSubtextChange(e.target.value)} placeholder="e.g. Help me hit $50!" />
                    </div>
                  </div>
                )}
                {(settings.showSubGoal || settings.showKicksGoal) && (
                  <div style={{ marginLeft: '24px', marginTop: 12 }}>
                    <div className="admin-select-wrap">
                      <label>Celebration duration (seconds before auto-increment)</label>
                      <input type="number" className="text-input" value={goalCelebrationDurationInput} onChange={(e) => handleGoalCelebrationDurationChange(e.target.value)} min={1} max={300} />
                    </div>
                  </div>
                )}
                {(settings.showSubGoal || settings.showKicksGoal) && (
                  <div className="stream-goals-override" style={{ marginLeft: '24px', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                    <div className="stream-goals-override-fields">
                      {settings.showSubGoal && (
                        <div className="admin-select-wrap">
                          <label>Current subs</label>
                          <input key={`subs-${settings.streamGoals?.subs ?? 0}`} type="number" className="text-input admin-number-input" defaultValue={settings.streamGoals?.subs ?? 0} id="stream-goals-subs-input" min={0} />
                        </div>
                      )}
                      {settings.showKicksGoal && (
                        <div className="admin-select-wrap">
                          <label>Current kicks</label>
                          <input key={`kicks-${settings.streamGoals?.kicks ?? 0}`} type="number" className="text-input admin-number-input" defaultValue={settings.streamGoals?.kicks ?? 0} id="stream-goals-kicks-input" min={0} />
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          try {
                            const body: { subs?: number; kicks?: number } = {};
                            if (settings.showSubGoal) {
                              const el = document.getElementById('stream-goals-subs-input') as HTMLInputElement;
                              if (el) body.subs = Math.max(0, parseInt(el.value, 10) || 0);
                            }
                            if (settings.showKicksGoal) {
                              const el = document.getElementById('stream-goals-kicks-input') as HTMLInputElement;
                              if (el) body.kicks = Math.max(0, parseInt(el.value, 10) || 0);
                            }
                            if (Object.keys(body).length === 0) return;
                            const r = await authenticatedFetch('/api/stream-goals', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(body),
                            });
                            const data = await r.json();
                            if (r.ok && data) {
                              setSettings((prev) => ({ ...prev, streamGoals: { subs: data.subs ?? 0, kicks: data.kicks ?? 0 } }));
                              setToast({ type: 'saved', message: 'Goals updated' });
                            } else {
                              setToast({ type: 'error', message: 'Update failed' });
                            }
                          } catch {
                            setToast({ type: 'error', message: 'Update failed' });
                          }
                          setTimeout(() => setToast(null), 2000);
                        }}
                      >
                        Update
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* === CHAT BROADCASTS === */}
          <CollapsibleSection id="chat-broadcasts" title="📢 Chat broadcasts">
            <div className="setting-group">
              <div className="broadcast-options-list">
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastLocation} onChange={(e) => { setKickChatBroadcastLocation(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastLocation: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">📍</span>
                  <span>Location — periodic location update</span>
                </label>
                {kickChatBroadcastLocation && (
                  <div className="broadcast-option-detail">
                    <label className="checkbox-label-row-sm">
                      Every <input type="number" className="text-input number-input" value={kickChatBroadcastLocationIntervalMin} onChange={(e) => { setKickChatBroadcastLocationIntervalMin(Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 5))); scheduleKickMessagesSave(); }} min={1} max={120} /> min
                    </label>
                  </div>
                )}
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastStreamTitle} onChange={(e) => { setKickChatBroadcastStreamTitle(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastStreamTitle: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">📺</span>
                  <span>Stream title — on title change</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWeather} onChange={(e) => { setKickChatBroadcastWeather(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWeather: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">🌤️</span>
                  <span>Weather — rain, storm, snow, fog, etc.</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastHeartrate} onChange={(e) => { setKickChatBroadcastHeartrate(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastHeartrate: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">❤️</span>
                  <span>Heart rate — when exceeds thresholds below</span>
                </label>
                {kickChatBroadcastHeartrate && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        High: <input type="number" className="text-input number-input" value={kickChatBroadcastHeartrateMinBpm} onChange={(e) => { setKickChatBroadcastHeartrateMinBpm(Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 100))); scheduleKickMessagesSave(); }} min={0} max={250} /> BPM
                      </label>
                      <label className="checkbox-label-row-sm">
                        Very high: <input type="number" className="text-input number-input" value={kickChatBroadcastHeartrateVeryHighBpm} onChange={(e) => { setKickChatBroadcastHeartrateVeryHighBpm(Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 120))); scheduleKickMessagesSave(); }} min={0} max={250} /> BPM
                      </label>
                    </div>
                  </div>
                )}
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastSpeed} onChange={(e) => { setKickChatBroadcastSpeed(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastSpeed: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">🚀</span>
                  <span>Speed — new top speed above min below</span>
                </label>
                {kickChatBroadcastSpeed && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        Min <input type="number" className="text-input number-input" value={kickChatBroadcastSpeedMinKmh} onChange={(e) => { setKickChatBroadcastSpeedMinKmh(Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 20))); scheduleKickMessagesSave(); }} min={0} max={500} /> km/h
                      </label>
                      <label className="checkbox-label-row-sm">
                        Cooldown <input type="number" className="text-input number-input" value={kickChatBroadcastSpeedTimeoutMin} onChange={(e) => { setKickChatBroadcastSpeedTimeoutMin(Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 5))); scheduleKickMessagesSave(); }} min={1} max={120} /> min
                      </label>
                    </div>
                  </div>
                )}
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastAltitude} onChange={(e) => { setKickChatBroadcastAltitude(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastAltitude: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon" aria-hidden="true">⛰️</span>
                  <span>Altitude — new top altitude above min below</span>
                </label>
                {kickChatBroadcastAltitude && (
                  <div className="broadcast-option-detail">
                    <div className="form-row-wrap">
                      <label className="checkbox-label-row-sm">
                        Min <input type="number" className="text-input number-input" value={kickChatBroadcastAltitudeMinM} onChange={(e) => { setKickChatBroadcastAltitudeMinM(Math.max(0, Math.min(9000, parseInt(e.target.value, 10) || 50))); scheduleKickMessagesSave(); }} min={0} max={9000} /> m
                      </label>
                      <label className="checkbox-label-row-sm">
                        Cooldown <input type="number" className="text-input number-input" value={kickChatBroadcastAltitudeTimeoutMin} onChange={(e) => { setKickChatBroadcastAltitudeTimeoutMin(Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 5))); scheduleKickMessagesSave(); }} min={1} max={120} /> min
                      </label>
                    </div>
                  </div>
                )}
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWellnessSteps} onChange={(e) => { setKickChatBroadcastWellnessSteps(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessSteps: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">👟</span>
                  <span>Steps — at 1k, 2k, 5k, 10k…</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWellnessDistance} onChange={(e) => { setKickChatBroadcastWellnessDistance(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessDistance: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">🚶</span>
                  <span>Distance — at 1, 2, 5, 10 km…</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWellnessFlights} onChange={(e) => { setKickChatBroadcastWellnessFlights(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessFlights: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">🪜</span>
                  <span>Flights climbed — at 5, 10, 25, 50…</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWellnessActiveCalories} onChange={(e) => { setKickChatBroadcastWellnessActiveCalories(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessActiveCalories: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">🔥</span>
                  <span>Active calories — at 100, 250, 500, 1k…</span>
                </label>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="poll" title="🗳️ Poll & Rank">
            <div className="setting-group">
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
                        <p style={{ fontSize: 12, color: '#999', margin: '8px 0 0' }}>
                          <strong>!poll</strong> Question? Option1, Option2 — defaults to Yes/No if no options given.<br />
                          <strong>!rank</strong> Option1, Option2, Option3 — viewers vote for their favorite.
                        </p>
                      </>
                    )}
                  </div>
                </div>
          </CollapsibleSection>

          <CollapsibleSection id="message-templates" title="📋 Chat message templates">
            <div className="setting-group">
                <div className="form-stack">
                  {TEMPLATE_GROUP_CONFIG.map((group) => (
                    <div key={group.toggleKey} className="kick-message-group kick-message-card">
                      {group.toggleKey === 'kicksGifted' && (
                        <div className="kick-group-options">
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
          </CollapsibleSection>

          <CollapsibleSection id="danger-zone" title="⚠️ Danger zone">
            <p className="input-hint" style={{ marginBottom: '1rem' }}>Manual resets if auto-reset on stream start fails or data needs clearing mid-stream.</p>
            <div className="danger-zone-grid">
              <button
                type="button"
                className="btn btn-danger btn-small"
                onClick={async () => {
                  if (!confirm('Reset wellness session? Clears steps, distance, flights, and calories since stream start.')) return;
                  try {
                    const r = await authenticatedFetch('/api/reset-wellness-session', { method: 'POST' });
                    const data = await r.json();
                    if (r.ok) setToast({ type: 'saved', message: 'Wellness session reset' });
                    else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                  } catch { setToast({ type: 'error', message: 'Reset failed' }); }
                  setTimeout(() => setToast(null), 3000);
                }}
              >
                🔄 Reset wellness (steps, distance, calories)
              </button>
              <button
                type="button"
                className="btn btn-danger btn-small"
                onClick={async () => {
                  if (!confirm('Reset tazos leaderboard? Clears all player tazos and gambling state.')) return;
                  try {
                    const r = await authenticatedFetch('/api/reset-leaderboard', { method: 'POST' });
                    const data = await r.json();
                    if (r.ok) setToast({ type: 'saved', message: 'Tazos leaderboard reset' });
                    else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                  } catch { setToast({ type: 'error', message: 'Reset failed' }); }
                  setTimeout(() => setToast(null), 3000);
                }}
              >
                🔄 Reset tazos leaderboard
              </button>
              <button
                type="button"
                className="btn btn-danger btn-small"
                onClick={async () => {
                  if (!confirm('Reset entire stream session? Clears wellness, leaderboard, goals, milestones, and uptime.')) return;
                  try {
                    const r = await authenticatedFetch('/api/reset-stream-session', { method: 'POST' });
                    const data = await r.json();
                    if (r.ok) setToast({ type: 'saved', message: 'Full stream session reset' });
                    else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                  } catch { setToast({ type: 'error', message: 'Reset failed' }); }
                  setTimeout(() => setToast(null), 3000);
                }}
              >
                🔄 Reset full stream session
              </button>
            </div>
          </CollapsibleSection>

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