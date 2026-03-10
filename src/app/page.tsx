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
import type { TriviaState } from '@/types/trivia';
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
  const [subGoalSubtextInput, setSubGoalSubtextInput] = useState('');
  const [kicksGoalSubtextInput, setKicksGoalSubtextInput] = useState('');
  const [donationsGoalSubtextInput, setDonationsGoalSubtextInput] = useState('');
  const [subGoalTargetInput, setSubGoalTargetInput] = useState<string>('10');
  const [kicksGoalTargetInput, setKicksGoalTargetInput] = useState<string>('1000');
  const [donationsGoalTargetInput, setDonationsGoalTargetInput] = useState<string>('0');
  const [donationsCurrentInput, setDonationsCurrentInput] = useState<string>('0');
  const [chipRewardTitleInput, setChipRewardTitleInput] = useState<string>('Buy Credits');
  const [chipRewardChipsInput, setChipRewardChipsInput] = useState<string>('50');
  const subGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const donationsGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chipRewardTitleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chipRewardChipsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
  const [kickPollDuration, setKickPollDuration] = useState(120);
  const [kickPollEveryoneCanStart, setKickPollEveryoneCanStart] = useState(false);
  const [kickPollModsCanStart, setKickPollModsCanStart] = useState(true);
  const [kickPollVipsCanStart, setKickPollVipsCanStart] = useState(false);
  const [kickPollOgsCanStart, setKickPollOgsCanStart] = useState(false);
  const [kickPollSubsCanStart, setKickPollSubsCanStart] = useState(false);
  const [kickPollMaxQueued, setKickPollMaxQueued] = useState(5);
  const [kickPollOneVotePerPerson, setKickPollOneVotePerPerson] = useState(false);
  const [triviaQuestion, setTriviaQuestion] = useState('');
  const [triviaAnswers, setTriviaAnswers] = useState('');
  const [triviaPoints, setTriviaPoints] = useState(50);
  const [triviaRandomQuestionsText, setTriviaRandomQuestionsText] = useState('');
  const [triviaDefaultPoints, setTriviaDefaultPoints] = useState(50);
  const [triviaStartLoading, setTriviaStartLoading] = useState(false);
  const [activeTriviaState, setActiveTriviaState] = useState<TriviaState | null | undefined>(undefined);
  const triviaRandomQuestionsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
    fetch('/api/trivia-settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.randomQuestionsText !== undefined) setTriviaRandomQuestionsText(d.randomQuestionsText ?? '');
        if (d?.defaultPoints != null) setTriviaDefaultPoints(d.defaultPoints);
      })
      .catch(() => {});
    fetch('/api/get-settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setActiveTriviaState(d?.triviaState ?? null);
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

  // Poll current trivia state so admin reflects when someone wins (overlay clears via SSE)
  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      fetch('/api/get-settings', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setActiveTriviaState(d?.triviaState ?? null))
        .catch(() => {});
    };
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
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

  // Poll location every 30s so the admin preview stays in sync with the overlay
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(fetchLocationData, 30_000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchLocationData]);

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
    const subInfo = settings.showSubGoal
      ? { current: settings.streamGoals?.subs ?? 0, target: settings.subGoalTarget ?? 5 }
      : undefined;
    const kicksInfo = settings.showKicksGoal
      ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 100 }
      : undefined;
    const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart, subInfo, kicksInfo);
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
  }, [
    kickStatus?.connected,
    kickStreamTitleCustom,
    kickStreamTitleRawLocation,
    kickStreamTitleIncludeLocation,
    settings.locationDisplay,
    settings.customLocation,
    settings.showSubGoal,
    settings.showKicksGoal,
    settings.subGoalTarget,
    settings.kicksGoalTarget,
    settings.streamGoals?.subs,
    settings.streamGoals?.kicks,
  ]);

  const saveKickMessages = useCallback(async (overrides?: {
    messages?: KickMessageTemplates;
    enabled?: KickMessageEnabled;
    templateEnabled?: KickMessageTemplateEnabled;
    alertSettings?: Partial<{
      minimumKicks: number;
      chatBroadcastStreamTitle: boolean;
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
    }>;
  }) => {
    const messages = overrides?.messages ?? kickMessages;
    const enabled = overrides?.enabled ?? kickMessageEnabled;
    const templateEnabled = overrides?.templateEnabled ?? kickTemplateEnabled;
    const alertSettings = overrides?.alertSettings ?? {
      minimumKicks: kickMinimumKicks,
      chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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
  }, [kickMessages, kickMessageEnabled, kickTemplateEnabled, kickMinimumKicks, kickChatBroadcastStreamTitle, kickChatBroadcastWeather, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm, kickChatBroadcastSpeed, kickChatBroadcastSpeedMinKmh, kickChatBroadcastSpeedTimeoutMin, kickChatBroadcastAltitude, kickChatBroadcastAltitudeMinM, kickChatBroadcastAltitudeTimeoutMin, kickChatBroadcastWellnessSteps, kickChatBroadcastWellnessDistance]);

  const kickAlertSettingsRef = useRef({
    minimumKicks: kickMinimumKicks,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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
  });
  kickAlertSettingsRef.current = {
    minimumKicks: kickMinimumKicks,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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

  // Debounced subtitle inputs (1s delay before saving)
  const handleSubGoalSubtextChange = useCallback((value: string) => {
    setSubGoalSubtextInput(value);
    if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
    subGoalSubtextTimeoutRef.current = setTimeout(() => {
      subGoalSubtextTimeoutRef.current = null;
      handleSettingsChange({ subGoalSubtext: value || undefined });
    }, 1000);
  }, [handleSettingsChange]);

  const handleKicksGoalSubtextChange = useCallback((value: string) => {
    setKicksGoalSubtextInput(value);
    if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
    kicksGoalSubtextTimeoutRef.current = setTimeout(() => {
      kicksGoalSubtextTimeoutRef.current = null;
      handleSettingsChange({ kicksGoalSubtext: value || undefined });
    }, 1000);
  }, [handleSettingsChange]);

  const handleDonationsGoalSubtextChange = useCallback((value: string) => {
    setDonationsGoalSubtextInput(value);
    if (donationsGoalSubtextTimeoutRef.current) clearTimeout(donationsGoalSubtextTimeoutRef.current);
    donationsGoalSubtextTimeoutRef.current = setTimeout(() => {
      donationsGoalSubtextTimeoutRef.current = null;
      handleSettingsChange({ donationsGoalSubtext: value || undefined });
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

  // Sync sub/kicks goal step inputs from settings (show the step/increment, not the snapped target)
  useEffect(() => {
    setSubGoalTargetInput(String(settings.subGoalIncrement ?? settings.subGoalTarget ?? 10));
    setKicksGoalTargetInput(String(settings.kicksGoalIncrement ?? settings.kicksGoalTarget ?? 1000));
  }, [settings.subGoalIncrement, settings.kicksGoalIncrement, settings.subGoalTarget, settings.kicksGoalTarget]);

  // Sync donations goal target input from settings (in USD)
  useEffect(() => {
    setDonationsGoalTargetInput(String((settings.donationsGoalTargetCents ?? 0) / 100));
  }, [settings.donationsGoalTargetCents]);

  // Debounced handlers for number inputs (1s delay before saving)
  const handleSubGoalTargetChange = useCallback((value: string) => {
    setSubGoalTargetInput(value);
    if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
    subGoalTargetTimeoutRef.current = setTimeout(() => {
      subGoalTargetTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      const count = settings.streamGoals?.subs ?? 0;
      const snapped = count >= n ? (Math.floor(count / n) + 1) * n : n;
      // input stays showing n (the step), not snapped — user sees their multiplier
      handleSettingsChange({ subGoalTarget: snapped, subGoalIncrement: n });
    }, 1000);
  }, [handleSettingsChange, settings.streamGoals]);

  const handleKicksGoalTargetChange = useCallback((value: string) => {
    setKicksGoalTargetInput(value);
    if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
    kicksGoalTargetTimeoutRef.current = setTimeout(() => {
      kicksGoalTargetTimeoutRef.current = null;
      const n = Math.max(1, parseInt(value, 10) || 1);
      const count = settings.streamGoals?.kicks ?? 0;
      const snapped = count >= n ? (Math.floor(count / n) + 1) * n : n;
      // input stays showing n (the step), not snapped
      handleSettingsChange({ kicksGoalTarget: snapped, kicksGoalIncrement: n });
    }, 1000);
  }, [handleSettingsChange, settings.streamGoals]);

  const donationsGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDonationsGoalTargetChange = useCallback((value: string) => {
    setDonationsGoalTargetInput(value);
    if (donationsGoalTargetTimeoutRef.current) clearTimeout(donationsGoalTargetTimeoutRef.current);
    donationsGoalTargetTimeoutRef.current = setTimeout(() => {
      donationsGoalTargetTimeoutRef.current = null;
      const n = Math.max(0, parseFloat(value) || 0);
      handleSettingsChange({ donationsGoalTargetCents: Math.round(n * 100) });
    }, 1000);
  }, [handleSettingsChange]);

  useEffect(() => {
    return () => {
      if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
      if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
      if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
      if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
      if (donationsGoalSubtextTimeoutRef.current) clearTimeout(donationsGoalSubtextTimeoutRef.current);
      if (chipRewardTitleTimeoutRef.current) clearTimeout(chipRewardTitleTimeoutRef.current);
      if (chipRewardChipsTimeoutRef.current) clearTimeout(chipRewardChipsTimeoutRef.current);
      if (triviaRandomQuestionsTimeoutRef.current) clearTimeout(triviaRandomQuestionsTimeoutRef.current);
      if (donationsGoalTargetTimeoutRef.current) clearTimeout(donationsGoalTargetTimeoutRef.current);
    };
  }, []);

  // Sync subtitle inputs from settings
  useEffect(() => {
    setSubGoalSubtextInput(settings.subGoalSubtext ?? '');
  }, [settings.subGoalSubtext]);

  useEffect(() => {
    setKicksGoalSubtextInput(settings.kicksGoalSubtext ?? '');
  }, [settings.kicksGoalSubtext]);

  useEffect(() => {
    setDonationsGoalSubtextInput(settings.donationsGoalSubtext ?? '');
  }, [settings.donationsGoalSubtext]);

  // Sync donations current total input from stream goals
  useEffect(() => {
    setDonationsCurrentInput(String((settings.streamGoals?.donationsCents ?? 0) / 100));
  }, [settings.streamGoals?.donationsCents]);

  // Sync channel reward inputs from settings
  useEffect(() => {
    setChipRewardTitleInput(settings.chipRewardTitle ?? 'Buy Credits');
    setChipRewardChipsInput(String(settings.chipRewardChips ?? 50));
  }, [settings.chipRewardTitle, settings.chipRewardChips]);

  // Debounced channel reward title (1s delay before saving)
  const handleChipRewardTitleChange = useCallback((value: string) => {
    setChipRewardTitleInput(value);
    if (chipRewardTitleTimeoutRef.current) clearTimeout(chipRewardTitleTimeoutRef.current);
    chipRewardTitleTimeoutRef.current = setTimeout(() => {
      chipRewardTitleTimeoutRef.current = null;
      handleSettingsChange({ chipRewardTitle: value || 'Buy Credits' });
    }, 1000);
  }, [handleSettingsChange]);

  // Debounced credits per redemption (1s delay before saving)
  const handleChipRewardChipsChange = useCallback((value: string) => {
    setChipRewardChipsInput(value);
    if (chipRewardChipsTimeoutRef.current) clearTimeout(chipRewardChipsTimeoutRef.current);
    chipRewardChipsTimeoutRef.current = setTimeout(() => {
      chipRewardChipsTimeoutRef.current = null;
      const n = Math.max(1, Math.min(10000, parseInt(value, 10) || 50));
      handleSettingsChange({ chipRewardChips: n });
    }, 1000);
  }, [handleSettingsChange]);

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

  // Derived overlay block toggles for simpler UI
  const wellnessBlockEnabled =
    (settings.showSteps ?? true) ||
    (settings.showDistance ?? true);

  const travelBlockEnabled =
    (settings.showWeather ?? false) ||
    (settings.showAltitude ?? true) ||
    (settings.showSpeed ?? true);


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

          {/* Location, map & overlay — merged for IRL: where am I + what do I show */}
          <CollapsibleSection id="location-map" title="📍 Location, map &amp; overlay">
            <div className="setting-group">
              {/* A: Current location */}
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Current location</h4>
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

              {/* B: Location display & map */}
              <h4 className="subsection-label" style={{ marginBottom: 8, marginTop: 20 }}>Location display &amp; map</h4>
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
              <div className="admin-select-wrap" style={{ marginTop: '16px', opacity: settings.locationDisplay === 'hidden' ? 0.6 : 1 }}>
                <label>Map</label>
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
                    🏃 When moving (≥10 km/h)
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

            {/* C: Overlay toggles */}
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Overlay — what appears on stream</h4>
              <h5 className="subsection-label" style={{ marginBottom: 6, fontSize: '0.9em', opacity: 0.9 }}>Top-left (wellness)</h5>
              <div className="checkbox-group" style={{ marginBottom: 8 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={wellnessBlockEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      handleSettingsChange({
                        showSteps: checked,
                        showDistance: checked,
                      });
                    }}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show wellness block (steps, distance)</span>
                </label>
              </div>
              <details className="admin-advanced-details" style={{ marginTop: 4, marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', opacity: 0.9, fontSize: '0.85rem' }}>
                  Advanced wellness display (toggle individual metrics)
                </summary>
                <div className="checkbox-group" style={{ marginTop: 6 }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={settings.showSteps ?? true} onChange={(e) => handleSettingsChange({ showSteps: e.target.checked })} className="checkbox-input" />
                    <span className="checkbox-text">Steps</span>
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={settings.showDistance ?? true} onChange={(e) => handleSettingsChange({ showDistance: e.target.checked })} className="checkbox-input" />
                    <span className="checkbox-text">Distance</span>
                  </label>
                </div>
              </details>

              <h5 className="subsection-label" style={{ marginBottom: 6, fontSize: '0.9em', opacity: 0.9 }}>Top-right (location)</h5>
              <div className="checkbox-group" style={{ marginBottom: 8 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={travelBlockEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      handleSettingsChange({
                        showWeather: checked,
                        showAltitude: checked,
                        showSpeed: checked,
                      });
                    }}
                    className="checkbox-input"
                    disabled={settings.locationDisplay === 'hidden'}
                  />
                  <span className="checkbox-text">Show travel panel (weather, speed, altitude)</span>
                </label>
              </div>
              <details className="admin-advanced-details" style={{ marginTop: 4, marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', opacity: 0.9, fontSize: '0.85rem' }}>
                  Advanced travel display (toggle individual metrics)
                </summary>
                <div className="checkbox-group" style={{ marginTop: 6 }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.showWeather ?? false}
                      onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                      className="checkbox-input"
                      disabled={settings.locationDisplay === 'hidden'}
                    />
                    <span className="checkbox-text">Weather</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.showAltitude ?? true}
                      onChange={(e) => handleSettingsChange({ showAltitude: e.target.checked })}
                      className="checkbox-input"
                      disabled={settings.locationDisplay === 'hidden'}
                    />
                    <span className="checkbox-text">Altitude</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.showSpeed ?? true}
                      onChange={(e) => handleSettingsChange({ showSpeed: e.target.checked })}
                      className="checkbox-input"
                      disabled={settings.locationDisplay === 'hidden'}
                    />
                    <span className="checkbox-text">Speed</span>
                  </label>
                </div>
              </details>
              <h5 className="subsection-label" style={{ marginBottom: 6, fontSize: '0.9em', opacity: 0.9 }}>Bottom-right &amp; alerts</h5>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={settings.showGoalsRotation !== false} onChange={(e) => handleSettingsChange({ showGoalsRotation: e.target.checked })} className="checkbox-input" />
                  <span className="checkbox-text">Show rotating section (goals, poll)</span>
                </label>
                <label className="checkbox-label" style={{ marginTop: 4 }}>
                  <input type="checkbox" checked={settings.showOverlayAlerts ?? true} onChange={(e) => handleSettingsChange({ showOverlayAlerts: e.target.checked })} className="checkbox-input" />
                  <span className="checkbox-text">Show overlay alerts (subs, gifts, kicks)</span>
                </label>
              </div>
              <div className="button-row" style={{ marginTop: 12 }}>
                <span className="group-label" style={{ marginRight: 8 }}>Test alert:</span>
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
                    {type === 'kicks' && '💚 Kicks'}
                  </button>
                ))}
              </div>
            </div>
          </CollapsibleSection>

          {/* Stream goals — common for IRL */}
          <CollapsibleSection id="stream-goals" title="🎯 Stream goals">
            <div className="setting-group">
              {/* Sub goal */}
              <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Subs</div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Goal step (milestone interval)</label>
                  <input type="number" className="text-input" value={subGoalTargetInput} onChange={(e) => handleSubGoalTargetChange(e.target.value)} min={1} />
                </div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Current count</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input key={`subs-${settings.streamGoals?.subs ?? 0}`} type="number" className="text-input admin-number-input" defaultValue={settings.streamGoals?.subs ?? 0} id="stream-goals-subs-input" min={0} style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        try {
                          const el = document.getElementById('stream-goals-subs-input') as HTMLInputElement;
                          if (!el) return;
                          const r = await authenticatedFetch('/api/stream-goals', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ subs: Math.max(0, parseInt(el.value, 10) || 0) }),
                          });
                          const data = await r.json();
                          if (r.ok && data) {
                            setSettings((prev) => ({
                              ...prev,
                              streamGoals: {
                                subs: data.subs ?? 0,
                                kicks: data.kicks ?? prev.streamGoals?.kicks ?? 0,
                                donationsCents: data.donationsCents ?? prev.streamGoals?.donationsCents ?? 0,
                              },
                            }));
                            setToast({ type: 'saved', message: 'Subs updated' });
                          } else {
                            setToast({ type: 'error', message: 'Update failed' });
                          }
                        } catch {
                          setToast({ type: 'error', message: 'Update failed' });
                        }
                        setTimeout(() => setToast(null), 2000);
                      }}
                    >
                      Set
                    </button>
                  </div>
                </div>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={settings.showSubGoal ?? false} onChange={(e) => handleSettingsChange({ showSubGoal: e.target.checked })} className="checkbox-input" />
                    <span className="checkbox-text">Show progress on overlay & title</span>
                  </label>
                </div>
                <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                  <label>Subtitle (fixed goal label)</label>
                  <input
                    type="text"
                    className="text-input"
                    value={subGoalSubtextInput}
                    onChange={(e) => handleSubGoalSubtextChange(e.target.value)}
                    placeholder='e.g. "Push-ups", keeps goal fixed'
                  />
                </div>
              </div>

              {/* Kicks goal */}
              <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Kicks</div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Goal step (milestone interval)</label>
                  <input type="number" className="text-input" value={kicksGoalTargetInput} onChange={(e) => handleKicksGoalTargetChange(e.target.value)} min={1} />
                </div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Current count</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input key={`kicks-${settings.streamGoals?.kicks ?? 0}`} type="number" className="text-input admin-number-input" defaultValue={settings.streamGoals?.kicks ?? 0} id="stream-goals-kicks-input" min={0} style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        try {
                          const el = document.getElementById('stream-goals-kicks-input') as HTMLInputElement;
                          if (!el) return;
                          const r = await authenticatedFetch('/api/stream-goals', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ kicks: Math.max(0, parseInt(el.value, 10) || 0) }),
                          });
                          const data = await r.json();
                          if (r.ok && data) {
                            setSettings((prev) => ({
                              ...prev,
                              streamGoals: {
                                subs: data.subs ?? prev.streamGoals?.subs ?? 0,
                                kicks: data.kicks ?? 0,
                                donationsCents: data.donationsCents ?? prev.streamGoals?.donationsCents ?? 0,
                              },
                            }));
                            setToast({ type: 'saved', message: 'Kicks updated' });
                          } else {
                            setToast({ type: 'error', message: 'Update failed' });
                          }
                        } catch {
                          setToast({ type: 'error', message: 'Update failed' });
                        }
                        setTimeout(() => setToast(null), 2000);
                      }}
                    >
                      Set
                    </button>
                  </div>
                </div>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={settings.showKicksGoal ?? false} onChange={(e) => handleSettingsChange({ showKicksGoal: e.target.checked })} className="checkbox-input" />
                    <span className="checkbox-text">Show progress on overlay & title</span>
                  </label>
                </div>
                <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                  <label>Subtitle (fixed goal label)</label>
                  <input
                    type="text"
                    className="text-input"
                    value={kicksGoalSubtextInput}
                    onChange={(e) => handleKicksGoalSubtextChange(e.target.value)}
                    placeholder='e.g. "PLANK", keeps goal fixed'
                  />
                </div>
              </div>

              {/* Donations goal */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Donations</div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Goal amount (USD)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={donationsGoalTargetInput}
                    min={0}
                    step="0.5"
                    onChange={(e) => handleDonationsGoalTargetChange(e.target.value)}
                  />
                </div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Current total (USD)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      key={`donations-${settings.streamGoals?.donationsCents ?? 0}`}
                      type="number"
                      className="text-input admin-number-input"
                      value={donationsCurrentInput}
                      onChange={(e) => setDonationsCurrentInput(e.target.value)}
                      id="stream-goals-donations-input"
                      min={0}
                      step="0.5"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        try {
                          const raw = Math.max(0, parseFloat(donationsCurrentInput) || 0);
                          const cents = Math.round(raw * 100);
                          const r = await authenticatedFetch('/api/stream-goals', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ donationsCents: cents }),
                          });
                          const data = await r.json();
                          if (r.ok && data) {
                            setSettings((prev) => ({
                              ...prev,
                              streamGoals: {
                                subs: data.subs ?? prev.streamGoals?.subs ?? 0,
                                kicks: data.kicks ?? prev.streamGoals?.kicks ?? 0,
                                donationsCents: data.donationsCents ?? 0,
                              },
                            }));
                            setToast({ type: 'saved', message: 'Donations updated' });
                          } else {
                            setToast({ type: 'error', message: 'Update failed' });
                          }
                        } catch {
                          setToast({ type: 'error', message: 'Update failed' });
                        }
                        setTimeout(() => setToast(null), 2000);
                      }}
                    >
                      Set
                    </button>
                  </div>
                </div>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.showDonationsGoal ?? false}
                      onChange={(e) => handleSettingsChange({ showDonationsGoal: e.target.checked })}
                      className="checkbox-input"
                    />
                    <span className="checkbox-text">Show donations goal on overlay</span>
                  </label>
                </div>
                <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                  <label>Subtitle (fixed goal label)</label>
                  <input
                    type="text"
                    className="text-input"
                    value={donationsGoalSubtextInput}
                    onChange={(e) => handleDonationsGoalSubtextChange(e.target.value)}
                    placeholder='e.g. "Charity drive", keeps goal fixed'
                  />
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
                  dir="ltr"
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
                  {(() => {
                    const subInfo = settings.showSubGoal
                      ? { current: settings.streamGoals?.subs ?? 0, target: settings.subGoalTarget ?? 5 }
                      : undefined;
                    const kicksInfo = settings.showKicksGoal
                      ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 100 }
                      : undefined;
                    const loc = kickStreamTitleIncludeLocation ? kickStreamTitleLocation : '';
                    return loc || subInfo || kicksInfo
                      ? buildStreamTitle(kickStreamTitleCustom, loc, subInfo, kicksInfo)
                      : kickStreamTitleCustom || <span style={{ opacity: 0.5 }}>No title yet</span>;
                  })()}
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
                        const subInfo = settings.showSubGoal
                          ? { current: settings.streamGoals?.subs ?? 0, target: settings.subGoalTarget ?? 5 }
                          : undefined;
                        const kicksInfo = settings.showKicksGoal
                          ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 100 }
                          : undefined;
                        const fullTitle = buildStreamTitle(kickStreamTitleCustom, locationPart, subInfo, kicksInfo);
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

          {/* Gambling & events */}
          <CollapsibleSection id="gambling" title="🎰 Credits & blackjack">
            <div className="setting-group">
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.gamblingEnabled !== false}
                    onChange={(e) => handleSettingsChange({ gamblingEnabled: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Enable Credits & blackjack</span>
                </label>
              </div>
              {settings.gamblingEnabled !== false && (
                <div className="checkbox-group" style={{ marginTop: '4px' }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.blackjackEnabled !== false}
                      onChange={(e) => handleSettingsChange({ blackjackEnabled: e.target.checked })}
                      className="checkbox-input"
                    />
                    <span className="checkbox-text">Blackjack (!bj / !deal)</span>
                  </label>
                </div>
              )}
              {settings.gamblingEnabled !== false && (
                <div className="setting-group" style={{ marginTop: 12 }}>
                  <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Channel reward title</label>
                  <input
                    type="text"
                    value={chipRewardTitleInput}
                    onChange={(e) => handleChipRewardTitleChange(e.target.value)}
                    placeholder="Buy Credits"
                    className="setting-input"
                    style={{ maxWidth: 240 }}
                  />
                  <p className="setting-hint" style={{ marginTop: 4, marginBottom: 8 }}>Create a Kick reward with this exact title; each redemption grants the credits below.</p>
                  <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Credits per redemption</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={chipRewardChipsInput}
                    onChange={(e) => handleChipRewardChipsChange(e.target.value)}
                    className="setting-input"
                    style={{ maxWidth: 100 }}
                  />
                </div>
              )}
              {settings.gamblingEnabled !== false && (
                <div className="setting-group" style={{ marginTop: 16 }}>
                  <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Ignored users</label>
                  <textarea
                    value={leaderboardExcludedBotsInput}
                    onChange={(e) => handleLeaderboardExcludedBotsChange(e.target.value)}
                    placeholder="e.g. bot1, bot2"
                    className="setting-input"
                    rows={3}
                    style={{ maxWidth: 360, resize: 'vertical' }}
                  />
                  <p className="setting-hint" style={{ marginTop: 4 }}>Comma or newline-separated usernames. They won’t earn Credits from sub/gift/kicks and won’t appear on !leaderboard.</p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Chat commands */}
          <CollapsibleSection id="chat-commands" title="💬 Chat commands">
            <div className="setting-group">
              {settings.gamblingEnabled !== false && (
                <>
                  <h4 className="subsection-label" style={{ marginBottom: 8 }}>Credits & blackjack</h4>
                  <div className="checkbox-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={settings.blackjackEnabled !== false} onChange={(e) => handleSettingsChange({ blackjackEnabled: e.target.checked })} className="checkbox-input" />
                      <span className="checkbox-text">!bj / !deal — blackjack</span>
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

          {/* Chat broadcasts */}
          <CollapsibleSection id="chat-broadcasts" title="📢 Chat broadcasts">
            <div className="setting-group">
              <div className="broadcast-options-list">
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
                  <input type="checkbox" checked={kickChatBroadcastWellnessSteps} onChange={(e) => { setKickChatBroadcastWellnessSteps(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessSteps: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">👟</span>
                  <span>Steps — at 1k, 2k, 5k, 10k…</span>
                </label>
                <label className="checkbox-label-row broadcast-checkbox-item">
                  <input type="checkbox" checked={kickChatBroadcastWellnessDistance} onChange={(e) => { setKickChatBroadcastWellnessDistance(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastWellnessDistance: e.target.checked } }); }} className="checkbox-input" />
                  <span className="radio-icon">🚶</span>
                  <span>Distance — at 1, 2, 5, 10 km…</span>
                </label>
                <details className="admin-advanced-details" style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', opacity: 0.9, fontSize: '0.9rem' }}>
                    Advanced options (heart rate, speed, altitude)
                  </summary>
                  <div style={{ marginTop: 12 }}>
                    <label className="checkbox-label-row broadcast-checkbox-item">
                      <input type="checkbox" checked={kickChatBroadcastHeartrate} onChange={(e) => { setKickChatBroadcastHeartrate(e.target.checked); saveKickMessages({ alertSettings: { chatBroadcastHeartrate: e.target.checked } }); }} className="checkbox-input" />
                      <span className="radio-icon" aria-hidden="true">❤️</span>
                      <span>Heart rate — when exceeds thresholds</span>
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
                      <span>Speed — new top speed above min</span>
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
                      <span>Altitude — new top altitude above min</span>
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
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={async () => {
                          if (!confirm("Reset wellness milestones? This only resets chat milestones for steps and distance. Today's totals stay unchanged.")) return;
                          try {
                            const r = await authenticatedFetch('/api/reset-wellness-session', { method: 'POST' });
                            const data = await r.json();
                            if (r.ok) setToast({ type: 'saved', message: 'Wellness milestones reset' });
                            else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                          } catch {
                            setToast({ type: 'error', message: 'Reset failed' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        🔄 Reset wellness milestones
                      </button>
                      <p className="input-hint" style={{ marginTop: 4 }}>
                        Resets milestone checkpoints for chat broadcasts only. Health app totals for today are not cleared.
                      </p>
                    </div>
                  </div>
                </details>
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
                        <div className="admin-select-wrap" style={{ marginTop: 12 }}>
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
                              const presets = [60, 90, 120, 180, 300, 600];
                              const opts = [...new Set([...presets, Math.max(60, Math.min(600, kickPollDuration))])].sort((a, b) => a - b);
                              return opts.map((n) => {
                                const label = n >= 60 ? `${Math.floor(n / 60)}${n % 60 !== 0 ? `:${String(n % 60).padStart(2, '0')}` : ''} min` : `${n} sec`;
                                return <option key={n} value={n}>{label}</option>;
                              });
                            })()}
                          </select>
                        </div>
                        <details className="admin-advanced-details" style={{ marginTop: 12 }}>
                          <summary style={{ cursor: 'pointer', opacity: 0.9, fontSize: '0.9rem' }}>Advanced options</summary>
                          <div style={{ marginTop: 12 }}>
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
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                </div>
          </CollapsibleSection>

          <CollapsibleSection id="trivia" title="❓ Trivia">
            <div className="setting-group">
              <p className="setting-hint" style={{ marginBottom: 12 }}>
                First-to-answer trivia. When active, uses the same overlay slot as the poll (poll takes priority). Mods can use <strong>!trivia</strong> in chat to start a random question from the list below, or start a custom one here.
              </p>
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="setting-hint" style={{ margin: 0 }}>
                  {activeTriviaState === undefined
                    ? 'Current: …'
                    : activeTriviaState && !activeTriviaState.winnerDisplayUntil
                      ? `Current: "${activeTriviaState.question}" (${activeTriviaState.points} pts)`
                      : 'Current: No trivia active'}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    fetch('/api/get-settings', { credentials: 'include' })
                      .then((r) => r.json())
                      .then((d) => setActiveTriviaState(d?.triviaState ?? null))
                      .catch(() => {});
                  }}
                >
                  Refresh
                </button>
              </div>
              <div className="form-stack" style={{ maxWidth: 520 }}>
                <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Custom question</label>
                <input
                  type="text"
                  className="setting-input"
                  value={triviaQuestion}
                  onChange={(e) => setTriviaQuestion(e.target.value)}
                  placeholder="e.g. What's my favourite dinner?"
                  style={{ maxWidth: 360 }}
                />
                <label className="setting-label" style={{ display: 'block', marginTop: 8, marginBottom: 4 }}>Correct answer(s)</label>
                <textarea
                  className="setting-input"
                  value={triviaAnswers}
                  onChange={(e) => setTriviaAnswers(e.target.value)}
                  placeholder="Comma or newline separated, e.g. Pizza, pasta"
                  rows={2}
                  style={{ maxWidth: 360, resize: 'vertical' }}
                />
                <label className="setting-label" style={{ display: 'block', marginTop: 8, marginBottom: 4 }}>Points for correct answer</label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  className="setting-input"
                  value={triviaPoints}
                  onChange={(e) => setTriviaPoints(Math.max(1, Math.min(10000, parseInt(e.target.value, 10) || 50)))}
                  style={{ maxWidth: 100 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  disabled={!triviaQuestion.trim() || !triviaAnswers.trim() || triviaStartLoading}
                  onClick={async () => {
                    setTriviaStartLoading(true);
                    try {
                      const answers = triviaAnswers.split(/[\n,]+/).map((a) => a.trim()).filter(Boolean);
                      const r = await authenticatedFetch('/api/trivia-start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question: triviaQuestion.trim(), answers, points: triviaPoints }),
                      });
                      const data = await r.json();
                      if (r.ok) {
                        setToast({ type: 'saved', message: 'Trivia started!' });
                        setActiveTriviaState(data.trivia ?? null);
                      } else {
                        setToast({ type: 'error', message: data.error ?? 'Failed to start trivia' });
                      }
                    } catch {
                      setToast({ type: 'error', message: 'Failed to start trivia' });
                    }
                    setTimeout(() => setToast(null), 3000);
                    setTriviaStartLoading(false);
                  }}
                >
                  {triviaStartLoading ? 'Starting…' : 'Start custom trivia'}
                </button>
              </div>
              <div className="form-stack" style={{ maxWidth: 520, marginTop: 24 }}>
                <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Random quiz questions (for !trivia)</label>
                <p className="setting-hint" style={{ marginBottom: 6 }}>
                  One question and answer per line. Format: <code>Question? Answer</code> or <code>Question ? Answer</code>. Use commas for multiple accepted answers (e.g. Favourite food? chicken Parmigiana, chicken parmi, chicken parma). To use the same questions in local and production, set the same <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code> in both (e.g. copy production&apos;s Upstash credentials into local .env).
                </p>
                <textarea
                  className="setting-input"
                  value={triviaRandomQuestionsText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTriviaRandomQuestionsText(val);
                    if (triviaRandomQuestionsTimeoutRef.current) clearTimeout(triviaRandomQuestionsTimeoutRef.current);
                    triviaRandomQuestionsTimeoutRef.current = setTimeout(() => {
                      triviaRandomQuestionsTimeoutRef.current = null;
                      authenticatedFetch('/api/trivia-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ randomQuestionsText: val }),
                      })
                        .then(async (r) => {
                          if (!r.ok) {
                            const d = await r.json().catch(() => ({}));
                            throw new Error((d as { error?: string }).error ?? 'Failed to save');
                          }
                          setToast({ type: 'saved', message: 'Saved!' });
                        })
                        .catch((e) => setToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save' }))
                        .finally(() => setTimeout(() => setToast(null), 2000));
                    }, 1000);
                  }}
                  placeholder={"What's my favourite dinner? Pizza\nBest pizza topping? Pepperoni"}
                  rows={6}
                  style={{ maxWidth: 360, resize: 'vertical' }}
                />
                <label className="setting-label" style={{ display: 'block', marginTop: 8, marginBottom: 4 }}>Default points (for !trivia random)</label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  className="setting-input"
                  value={triviaDefaultPoints}
                  onChange={async (e) => {
                    const val = Math.max(1, Math.min(10000, parseInt(e.target.value, 10) || 50));
                    setTriviaDefaultPoints(val);
                    try {
                      await authenticatedFetch('/api/trivia-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ defaultPoints: val }),
                      });
                      setToast({ type: 'saved', message: 'Saved!' });
                    } catch { setToast({ type: 'error', message: 'Failed to save' }); }
                    setTimeout(() => setToast(null), 2000);
                  }}
                  style={{ maxWidth: 100 }}
                />
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
            <p className="input-hint" style={{ marginBottom: '1rem' }}>
              Manual resets if auto-reset on stream start fails or data needs clearing mid-stream.
            </p>
            <div className="danger-zone-grid">
              <button
                type="button"
                className="btn btn-danger btn-small"
                onClick={async () => {
                  if (!confirm('Reset blackjack state? Clears active hands and deal cooldown. Does not reset Credits balances.')) return;
                  try {
                    const r = await authenticatedFetch('/api/reset-leaderboard', { method: 'POST' });
                    const data = await r.json();
                    if (r.ok) setToast({ type: 'saved', message: 'Blackjack state reset' });
                    else setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                  } catch { setToast({ type: 'error', message: 'Reset failed' }); }
                  setTimeout(() => setToast(null), 3000);
                }}
              >
                🔄 Reset blackjack state
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