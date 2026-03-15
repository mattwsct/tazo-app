"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { LINKS, type LinkItem } from '@/data/links';
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

function parseDurationToMs(input: string): number | undefined {
  const m = input.trim().match(/^([\d.]+)(s|sec|secs|m|min|mins|h|hr|hrs)$/i);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('h')) return Math.round(num * 3_600_000);
  if (unit.startsWith('m')) return Math.round(num * 60_000);
  return Math.round(num * 1_000);
}

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
  const [subGoalTargetInput, setSubGoalTargetInput] = useState<string>('10');
  const [kicksGoalTargetInput, setKicksGoalTargetInput] = useState<string>('1000');
  const [chipRewardTitleInput, setChipRewardTitleInput] = useState<string>('Buy 50 Credits');
  const [chipRewardTitle2Input, setChipRewardTitle2Input] = useState<string>('Buy 500 Credits');
  const subGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chipRewardTitleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chipRewardTitle2TimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
  const [triviaQuestion, setTriviaQuestion] = useState('');
  const [triviaAnswers, setTriviaAnswers] = useState('');
  const [triviaPoints, setTriviaPoints] = useState(50);
  const [triviaRandomQuestionsText, setTriviaRandomQuestionsText] = useState('');
  const [triviaDefaultPoints, setTriviaDefaultPoints] = useState(50);
  const [triviaStartLoading, setTriviaStartLoading] = useState(false);
  const [activeTriviaState, setActiveTriviaState] = useState<TriviaState | null | undefined>(undefined);
  const triviaRandomQuestionsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState<string>('');
  const [timerTitleInput, setTimerTitleInput] = useState<string>('');
  // Challenges & wallet
  const [challengesList, setChallengesList] = useState<{ id: number; description: string; bounty: number; status: string; expiresAt?: number }[]>([]);
  const [challengeBountyInput, setChallengeBountyInput] = useState<string>('');
  const [challengeDescInput, setChallengeDescInput] = useState<string>('');
  const [challengeDurationInput, setChallengeDurationInput] = useState<string>(''); // e.g. "10m", "30s", "1h"
  const [editingChallenge, setEditingChallenge] = useState<{ id: number; description: string; bounty: string; durationMs?: number } | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(15);
  const [walletAdjustInput, setWalletAdjustInput] = useState<string>('');
  // Links section state — initialize with LINKS so section is never empty
  const [linksData, setLinksData] = useState<LinkItem[]>(LINKS);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksSaving, setLinksSaving] = useState(false);
  // Integrations / API keys
  type ApiKeyStatus = { configured: boolean; masked: string | null; source: 'db' | 'env' | null };
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, ApiKeyStatus>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeysSaving, setApiKeysSaving] = useState<Record<string, boolean>>({});
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

  // Load challenges and wallet on mount and after resets
  const loadChallengesAndWallet = useCallback(async () => {
    try {
      const [cRes, wRes] = await Promise.all([
        fetch('/api/challenges', { credentials: 'include' }),
        fetch('/api/wallet', { credentials: 'include' }),
      ]);
      if (cRes.ok) {
        const d = await cRes.json() as { challenges?: { id: number; description: string; bounty: number; status: string }[] };
        setChallengesList(d.challenges ?? []);
      }
      if (wRes.ok) {
        const d = await wRes.json() as { balance?: number };
        if (typeof d.balance === 'number') setWalletBalance(d.balance);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadChallengesAndWallet();
  }, [isAuthenticated, loadChallengesAndWallet]);

  // Load links on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    setLinksLoading(true);
    authenticatedFetch('/api/admin/links')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { links?: LinkItem[] }) => { if (Array.isArray(d.links) && d.links.length > 0) setLinksData(d.links); })
      .catch((e) => { console.warn('[admin/links] fetch failed:', e); })
      .finally(() => setLinksLoading(false));
  }, [isAuthenticated]);

  // Load API key status on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    authenticatedFetch('/api/admin/api-keys')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: Record<string, ApiKeyStatus>) => { setApiKeyStatus(d); })
      .catch(() => {});
  }, [isAuthenticated]);

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
      ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 5000 }
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
    setKicksGoalTargetInput(String(settings.kicksGoalIncrement ?? settings.kicksGoalTarget ?? 5000));
  }, [settings.subGoalIncrement, settings.kicksGoalIncrement, settings.subGoalTarget, settings.kicksGoalTarget]);

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

  useEffect(() => {
    return () => {
      if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
      if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
      if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
      if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
      if (chipRewardTitleTimeoutRef.current) clearTimeout(chipRewardTitleTimeoutRef.current);
      if (chipRewardTitle2TimeoutRef.current) clearTimeout(chipRewardTitle2TimeoutRef.current);
      if (triviaRandomQuestionsTimeoutRef.current) clearTimeout(triviaRandomQuestionsTimeoutRef.current);
    };
  }, []);

  // Sync subtitle inputs from settings
  useEffect(() => {
    setSubGoalSubtextInput(settings.subGoalSubtext ?? '');
  }, [settings.subGoalSubtext]);

  useEffect(() => {
    setKicksGoalSubtextInput(settings.kicksGoalSubtext ?? '');
  }, [settings.kicksGoalSubtext]);

  // Sync channel reward inputs from settings
  useEffect(() => {
    setChipRewardTitleInput(settings.chipRewardTitle ?? 'Buy 50 Credits');
    setChipRewardTitle2Input(settings.chipRewardTitle2 ?? 'Buy 500 Credits');
  }, [settings.chipRewardTitle, settings.chipRewardTitle2]);

  // Debounced channel reward title 1 (1s delay before saving)
  const handleChipRewardTitleChange = useCallback((value: string) => {
    setChipRewardTitleInput(value);
    if (chipRewardTitleTimeoutRef.current) clearTimeout(chipRewardTitleTimeoutRef.current);
    chipRewardTitleTimeoutRef.current = setTimeout(() => {
      chipRewardTitleTimeoutRef.current = null;
      handleSettingsChange({ chipRewardTitle: value || 'Buy 50 Credits' });
    }, 1000);
  }, [handleSettingsChange]);

  // Debounced channel reward title 2 (1s delay before saving)
  const handleChipRewardTitle2Change = useCallback((value: string) => {
    setChipRewardTitle2Input(value);
    if (chipRewardTitle2TimeoutRef.current) clearTimeout(chipRewardTitle2TimeoutRef.current);
    chipRewardTitle2TimeoutRef.current = setTimeout(() => {
      chipRewardTitle2TimeoutRef.current = null;
      handleSettingsChange({ chipRewardTitle2: value || 'Buy 500 Credits' });
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
          <CollapsibleSection id="connection" title="🔗 Kick">
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

            {/* Stream title */}
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Stream title</h4>
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
                        ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 5000 }
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
                            ? { current: settings.streamGoals?.kicks ?? 0, target: settings.kicksGoalTarget ?? 5000 }
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

          {/* Location & map */}
          <CollapsibleSection id="location-map" title="📍 Location &amp; map">
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

          </CollapsibleSection>

          {/* Overlay & goals — what shows on stream + goal tracking */}
          <CollapsibleSection id="overlay" title="🖥️ Stream goals">
            <div className="setting-group">
              <div className="button-row" style={{ marginBottom: 16 }}>
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

            <div className="setting-group" style={{ paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Stream goals</h4>
              <p className="input-hint" style={{ marginBottom: 12, marginTop: 0 }}>Goals auto-increment when reached. Set a subtitle to keep the goal fixed instead.</p>
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

              {/* Timer */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Timer</div>
                <p className="input-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                  Starts a countdown timer on the overlay (same as using !timer in chat).
                </p>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Duration (minutes)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={timerMinutesInput}
                    min={0}
                    step="1"
                    onChange={(e) => setTimerMinutesInput(e.target.value)}
                  />
                </div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Title (optional)</label>
                  <input
                    type="text"
                    className="text-input"
                    value={timerTitleInput}
                    onChange={(e) => setTimerTitleInput(e.target.value)}
                    placeholder='e.g. "Break time"'
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      const minutes = parseFloat(timerMinutesInput);
                      if (!Number.isFinite(minutes) || minutes <= 0) {
                        setToast({ type: 'error', message: 'Enter a positive number of minutes' });
                        setTimeout(() => setToast(null), 2000);
                        return;
                      }
                      try {
                        const res = await authenticatedFetch('/api/timer', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ minutes, title: timerTitleInput }),
                        });
                        if (res.ok) {
                          setToast({ type: 'saved', message: 'Timer started' });
                        } else {
                          setToast({ type: 'error', message: 'Failed to start timer' });
                        }
                      } catch {
                        setToast({ type: 'error', message: 'Failed to start timer' });
                      }
                      setTimeout(() => setToast(null), 2000);
                    }}
                  >
                    Start / Restart timer
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      try {
                        const res = await authenticatedFetch('/api/timer', {
                          method: 'DELETE',
                        });
                        if (res.ok) {
                          setToast({ type: 'saved', message: 'Timer cleared' });
                        } else {
                          setToast({ type: 'error', message: 'Failed to clear timer' });
                        }
                      } catch {
                        setToast({ type: 'error', message: 'Failed to clear timer' });
                      }
                      setTimeout(() => setToast(null), 2000);
                    }}
                  >
                    Clear timer
                  </button>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Challenges & Wallet */}
          <CollapsibleSection id="challenges" title="🎯 Challenges &amp; wallet">
            <div className="setting-group">
              {/* Wallet */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Wallet</div>
                <div className="checkbox-group" style={{ marginBottom: 8 }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.walletEnabled ?? false}
                      onChange={(e) => handleSettingsChange({ walletEnabled: e.target.checked })}
                      className="checkbox-input"
                    />
                    <span className="checkbox-text">Show wallet on overlay &amp; auto-increment on subs/kicks</span>
                  </label>
                </div>
                <div className="admin-select-wrap" style={{ marginBottom: 8 }}>
                  <label>Starting balance (USD, resets each stream)</label>
                  <input
                    type="number"
                    className="text-input"
                    min={0}
                    step={1}
                    value={settings.walletStartingBalance ?? 15}
                    onChange={(e) => handleSettingsChange({ walletStartingBalance: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <p className="input-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                  Current balance: <strong>${walletBalance.toFixed(2)} USD</strong>
                  {' — '}Subs/gift subs add $5, kicks add $1 per 100.
                  Use !spent &lt;amount&gt; in chat (auto-converts local currency to USD).
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="admin-select-wrap" style={{ marginBottom: 0 }}>
                    <label>Adjust (USD)</label>
                    <input
                      type="number"
                      className="text-input"
                      placeholder="e.g. 20"
                      value={walletAdjustInput}
                      onChange={(e) => setWalletAdjustInput(e.target.value)}
                      style={{ width: 100 }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      const amount = parseFloat(walletAdjustInput);
                      if (!Number.isFinite(amount)) return;
                      try {
                        const res = await authenticatedFetch('/api/wallet', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'add', amount }),
                        });
                        if (res.ok) {
                          const d = await res.json() as { balance?: number };
                          if (typeof d.balance === 'number') setWalletBalance(d.balance);
                          setWalletAdjustInput('');
                          setToast({ type: 'saved', message: `Added $${amount.toFixed(2)}` });
                        }
                      } catch { /* ignore */ }
                      setTimeout(() => setToast(null), 2000);
                    }}
                  >
                    Add to wallet
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      const amount = parseFloat(walletAdjustInput);
                      if (!Number.isFinite(amount)) return;
                      try {
                        const res = await authenticatedFetch('/api/wallet', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'set', amount }),
                        });
                        if (res.ok) {
                          const d = await res.json() as { balance?: number };
                          if (typeof d.balance === 'number') setWalletBalance(d.balance);
                          setWalletAdjustInput('');
                          setToast({ type: 'saved', message: `Balance set to $${amount.toFixed(2)}` });
                        }
                      } catch { /* ignore */ }
                      setTimeout(() => setToast(null), 2000);
                    }}
                  >
                    Set balance
                  </button>
                </div>
              </div>

              {/* Challenges */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9em', opacity: 0.8 }}>Challenges</div>
                <p className="input-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                  Chat: !challenge 50 [10m] Do 20 pushups &nbsp;|&nbsp; done/fail/remove &lt;id&gt; &nbsp;|&nbsp; clear
                </p>

                {/* Add new challenge */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                  <div className="admin-select-wrap" style={{ marginBottom: 0 }}>
                    <label>Bounty ($)</label>
                    <input
                      type="number"
                      className="text-input"
                      placeholder="50"
                      min={0}
                      value={challengeBountyInput}
                      onChange={(e) => setChallengeBountyInput(e.target.value)}
                      style={{ width: 72 }}
                    />
                  </div>
                  <div className="admin-select-wrap" style={{ marginBottom: 0 }}>
                    <label>Timer (optional)</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="e.g. 10m"
                      value={challengeDurationInput}
                      onChange={(e) => setChallengeDurationInput(e.target.value)}
                      style={{ width: 80 }}
                    />
                  </div>
                  <div className="admin-select-wrap" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
                    <label>Description</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="e.g. Do 20 pushups"
                      value={challengeDescInput}
                      onChange={(e) => setChallengeDescInput(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key !== 'Enter') return;
                        const bounty = parseFloat(challengeBountyInput);
                        const desc = challengeDescInput.trim();
                        if (!Number.isFinite(bounty) || !desc) return;
                        const durationMs = parseDurationToMs(challengeDurationInput);
                        try {
                          const res = await authenticatedFetch('/api/challenges', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bounty, description: desc, ...(durationMs ? { durationMs } : {}) }),
                          });
                          if (res.ok) {
                            await loadChallengesAndWallet();
                            setChallengeBountyInput('');
                            setChallengeDescInput('');
                            setChallengeDurationInput('');
                          }
                        } catch { /* ignore */ }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      const bounty = parseFloat(challengeBountyInput);
                      const desc = challengeDescInput.trim();
                      if (!Number.isFinite(bounty) || bounty < 0) {
                        setToast({ type: 'error', message: 'Enter a valid bounty amount' });
                        setTimeout(() => setToast(null), 2000);
                        return;
                      }
                      if (!desc) {
                        setToast({ type: 'error', message: 'Enter a description' });
                        setTimeout(() => setToast(null), 2000);
                        return;
                      }
                      const durationMs = parseDurationToMs(challengeDurationInput);
                      try {
                        const res = await authenticatedFetch('/api/challenges', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ bounty, description: desc, ...(durationMs ? { durationMs } : {}) }),
                        });
                        if (res.ok) {
                          await loadChallengesAndWallet();
                          setChallengeBountyInput('');
                          setChallengeDescInput('');
                          setChallengeDurationInput('');
                          setToast({ type: 'saved', message: 'Challenge added' });
                        }
                      } catch { /* ignore */ }
                      setTimeout(() => setToast(null), 2000);
                    }}
                  >
                    Add challenge
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    title="Pick a random social task challenge ($15 bounty)"
                    onClick={async () => {
                      try {
                        const res = await authenticatedFetch('/api/challenges', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'random_social' }),
                        });
                        if (res.ok) {
                          await loadChallengesAndWallet();
                          setToast({ type: 'saved', message: 'Random social task added ($15)' });
                        } else {
                          const d = await res.json().catch(() => ({})) as { error?: string };
                          setToast({ type: 'error', message: d.error ?? 'Failed to add social task' });
                        }
                      } catch { /* ignore */ }
                      setTimeout(() => setToast(null), 2500);
                    }}
                  >
                    🌍 Random social task
                  </button>
                </div>

                {/* Challenge list */}
                {challengesList.length === 0 ? (
                  <p className="input-hint">No challenges yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {challengesList.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          background: 'rgba(255,255,255,0.07)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {editingChallenge?.id === c.id ? (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div className="admin-select-wrap" style={{ marginBottom: 0 }}>
                              <label>Bounty ($)</label>
                              <input
                                type="number"
                                className="text-input"
                                value={editingChallenge.bounty}
                                min={0}
                                onChange={(e) => setEditingChallenge({ ...editingChallenge, bounty: e.target.value })}
                                style={{ width: 80 }}
                              />
                            </div>
                            <div className="admin-select-wrap" style={{ marginBottom: 0, flex: 1 }}>
                              <label>Description</label>
                              <input
                                type="text"
                                className="text-input"
                                value={editingChallenge.description}
                                onChange={(e) => setEditingChallenge({ ...editingChallenge, description: e.target.value })}
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={async () => {
                                if (!editingChallenge) return;
                                const bounty = parseFloat(editingChallenge.bounty);
                                try {
                                  await authenticatedFetch('/api/challenges', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      id: editingChallenge.id,
                                      description: editingChallenge.description,
                                      bounty: Number.isFinite(bounty) ? bounty : undefined,
                                    }),
                                  });
                                  await loadChallengesAndWallet();
                                  setEditingChallenge(null);
                                } catch { /* ignore */ }
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={() => setEditingChallenge(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: '0.75em',
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: c.status === 'active' ? 'rgba(52,211,153,0.2)' : c.status === 'completed' ? 'rgba(139,92,246,0.25)' : 'rgba(239,68,68,0.2)',
                              color: c.status === 'active' ? '#34d399' : c.status === 'completed' ? '#a78bfa' : '#f87171',
                              fontWeight: 600,
                            }}>
                              {c.status}
                            </span>
                            <span style={{ fontWeight: 700, minWidth: 48 }}>${c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2)}</span>
                            <span style={{ flex: 1 }}>{c.description}</span>
                            {c.expiresAt && c.status === 'active' && (
                              <span style={{ fontSize: '0.75em', opacity: 0.6, flexShrink: 0 }}>
                                ⏱ {c.expiresAt > Date.now() ? `${Math.ceil((c.expiresAt - Date.now()) / 60000)}m left` : 'expired'}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              {c.status !== 'completed' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  title="Mark completed"
                                  onClick={async () => {
                                    await authenticatedFetch('/api/challenges', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: c.id, status: 'completed' }),
                                    });
                                    await loadChallengesAndWallet();
                                  }}
                                >
                                  ✅
                                </button>
                              )}
                              {c.status !== 'failed' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  title="Mark failed"
                                  onClick={async () => {
                                    await authenticatedFetch('/api/challenges', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: c.id, status: 'failed' }),
                                    });
                                    await loadChallengesAndWallet();
                                  }}
                                >
                                  ❌
                                </button>
                              )}
                              {c.status !== 'active' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  title="Reactivate"
                                  onClick={async () => {
                                    await authenticatedFetch('/api/challenges', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: c.id, status: 'active' }),
                                    });
                                    await loadChallengesAndWallet();
                                  }}
                                >
                                  ↩️
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                title="Edit"
                                onClick={() => setEditingChallenge({ id: c.id, description: c.description, bounty: String(c.bounty) })}
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                title="Remove"
                                onClick={async () => {
                                  await authenticatedFetch(`/api/challenges?id=${c.id}`, { method: 'DELETE' });
                                  await loadChallengesAndWallet();
                                }}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={async () => {
                          await authenticatedFetch('/api/challenges', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'clear' }),
                          });
                          await loadChallengesAndWallet();
                          setToast({ type: 'saved', message: 'Resolved challenges cleared' });
                          setTimeout(() => setToast(null), 2000);
                        }}
                      >
                        Clear resolved
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={loadChallengesAndWallet}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* Chat — commands and auto-broadcasts */}
          <CollapsibleSection id="chat" title="💬 Chat">
            <div className="setting-group">
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Commands</h4>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={settings.convertEnabled !== false && settings.mathEnabled !== false} onChange={(e) => handleSettingsChange({ convertEnabled: e.target.checked, mathEnabled: e.target.checked })} className="checkbox-input" />
                  <span className="checkbox-text">Chat commands (!convert, !math)</span>
                </label>
              </div>
              <div className="setting-separator" style={{ margin: '1.5rem 0' }} />
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Auto-broadcasts</h4>
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
                <div style={{ marginTop: 8 }}>
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
              </div>
            </div>

            {/* Chat message templates */}
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Message templates</h4>
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

          <CollapsibleSection id="games" title="🎮 Games">
            <div className="setting-group">
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Poll & Rank</h4>
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
                      </>
                    )}
                  </div>
              <div className="setting-separator" style={{ margin: '1.5rem 0' }} />
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Trivia</h4>
              <p className="input-hint" style={{ marginBottom: 12 }}>
                First-to-answer trivia. When active, uses the same overlay slot as the poll (poll takes priority). Mods can use <strong>!trivia</strong> in chat to start a random question from the list below, or start a custom one here.
              </p>
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="input-hint" style={{ margin: 0 }}>
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
                <p className="input-hint" style={{ marginBottom: 6 }}>
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
            {/* Credits & blackjack */}
            <div className="setting-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Credits & blackjack</h4>
              <div className="checkbox-group" style={{ marginBottom: '16px' }}>
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
              <div style={{ marginBottom: 16 }}>
                <p className="input-hint" style={{ marginTop: 0, marginBottom: 10 }}>Create Kick channel rewards with these exact titles to grant Credits on redemption.</p>
                <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Reward title — 50 Credits</label>
                <input
                  type="text"
                  value={chipRewardTitleInput}
                  onChange={(e) => handleChipRewardTitleChange(e.target.value)}
                  placeholder="Buy 50 Credits"
                  className="setting-input"
                  style={{ maxWidth: 260 }}
                />
                <label className="setting-label" style={{ display: 'block', marginBottom: 4, marginTop: 12 }}>Reward title — 500 Credits</label>
                <input
                  type="text"
                  value={chipRewardTitle2Input}
                  onChange={(e) => handleChipRewardTitle2Change(e.target.value)}
                  placeholder="Buy 500 Credits"
                  className="setting-input"
                  style={{ maxWidth: 260 }}
                />
              </div>
              <div>
                <label className="setting-label" style={{ display: 'block', marginBottom: 4 }}>Ignored users</label>
                <textarea
                  value={leaderboardExcludedBotsInput}
                  onChange={(e) => handleLeaderboardExcludedBotsChange(e.target.value)}
                  placeholder="e.g. bot1, bot2"
                  className="setting-input"
                  rows={3}
                  style={{ maxWidth: 360, resize: 'vertical' }}
                />
                <p className="input-hint" style={{ marginTop: 4 }}>Comma or newline-separated usernames. They won&apos;t earn Credits from sub/gift/kicks and won&apos;t appear on !leaderboard.</p>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="links" title="🔗 Links">
            <div className="setting-group">
              <p className="input-hint" style={{ marginBottom: 16 }}>
                Manage links shown on the homepage. Toggle visibility, edit titles, URLs, button labels, and button colors. Click Save when done.
              </p>
              {linksLoading ? (
                <p className="input-hint">Loading links…</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {linksData.map((link, idx) => {
                    // Extract hex colors from bg string e.g. "from-[#53fc18] to-[#2f8f0b]"
                    const hexMatches = link.bg.match(/#[0-9a-fA-F]{3,6}/g) ?? [];
                    const fromColor = hexMatches[0] ?? '#71717a';
                    const toColor = hexMatches[hexMatches.length - 1] ?? fromColor;
                    const gradientStyle = { background: `linear-gradient(to right, ${fromColor}, ${toColor})` };
                    return (
                      <div
                        key={link.id}
                        style={{
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.1)',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Color bar + header row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.04)' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 6, flexShrink: 0, ...gradientStyle }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e4e4e7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {link.button || link.title}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{link.category}</div>
                          </div>
                          <label className="checkbox-label-row" style={{ flexShrink: 0 }}>
                            <input
                              type="checkbox"
                              className="checkbox-input"
                              checked={link.showOnHomepage}
                              onChange={(e) => {
                                const updated = [...linksData];
                                updated[idx] = { ...updated[idx], showOnHomepage: e.target.checked };
                                setLinksData(updated);
                              }}
                            />
                            <span className="checkbox-text" style={{ fontSize: '0.8rem' }}>Show</span>
                          </label>
                        </div>
                        {/* Fields */}
                        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.02)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <label style={{ fontSize: '0.7rem', color: '#71717a', display: 'block', marginBottom: 3 }}>Button label</label>
                              <input
                                type="text"
                                className="setting-input"
                                value={link.button}
                                placeholder="Button label"
                                onChange={(e) => {
                                  const updated = [...linksData];
                                  updated[idx] = { ...updated[idx], button: e.target.value, title: e.target.value };
                                  setLinksData(updated);
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.7rem', color: '#71717a', display: 'block', marginBottom: 3 }}>Category</label>
                              <select
                                className="setting-input"
                                value={link.category}
                                onChange={(e) => {
                                  const updated = [...linksData];
                                  updated[idx] = { ...updated[idx], category: e.target.value as LinkItem['category'] };
                                  setLinksData(updated);
                                }}
                              >
                                <option value="streaming">Streaming</option>
                                <option value="social">Social</option>
                                <option value="support">Support</option>
                                <option value="other">Other</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: '#71717a', display: 'block', marginBottom: 3 }}>URL</label>
                            <input
                              type="url"
                              className="setting-input"
                              value={link.url}
                              placeholder="https://..."
                              onChange={(e) => {
                                const updated = [...linksData];
                                updated[idx] = { ...updated[idx], url: e.target.value };
                                setLinksData(updated);
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label style={{ fontSize: '0.7rem', color: '#71717a' }}>From</label>
                              <input
                                type="color"
                                value={fromColor}
                                onChange={(e) => {
                                  const updated = [...linksData];
                                  const newBg = `from-[${e.target.value}] to-[${toColor}]`;
                                  updated[idx] = { ...updated[idx], bg: newBg };
                                  setLinksData(updated);
                                }}
                                style={{ width: 32, height: 28, padding: 2, borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', cursor: 'pointer' }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label style={{ fontSize: '0.7rem', color: '#71717a' }}>To</label>
                              <input
                                type="color"
                                value={toColor}
                                onChange={(e) => {
                                  const updated = [...linksData];
                                  const newBg = `from-[${fromColor}] to-[${e.target.value}]`;
                                  updated[idx] = { ...updated[idx], bg: newBg };
                                  setLinksData(updated);
                                }}
                                style={{ width: 32, height: 28, padding: 2, borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', cursor: 'pointer' }}
                              />
                            </div>
                            <div style={{ flex: 1, height: 28, borderRadius: 4, ...gradientStyle }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={linksSaving}
                    onClick={async () => {
                      setLinksSaving(true);
                      try {
                        const r = await authenticatedFetch('/api/admin/links', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ links: linksData }),
                        });
                        if (r.ok) {
                          setToast({ type: 'saved', message: 'Links saved!' });
                        } else {
                          const d = await r.json().catch(() => ({}));
                          throw new Error((d as { error?: string }).error ?? 'Failed to save');
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save links' });
                      }
                      setLinksSaving(false);
                      setTimeout(() => setToast(null), 3000);
                    }}
                    style={{ alignSelf: 'flex-start', marginTop: 8 }}
                  >
                    {linksSaving ? 'Saving…' : 'Save links'}
                  </button>
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="discord-roles" title="💜 Discord role sync">
            <div className="setting-group">
              <p className="input-hint" style={{ marginBottom: 12 }}>
                When a viewer connects both Kick and Discord, new subs/resubs automatically assign them the subscriber role in your Discord server.
                Click below to remove the role from any subscribers whose subscription has lapsed.
              </p>
              <p className="input-hint" style={{ marginBottom: 16 }}>
                Requires: <code>DISCORD_BOT_TOKEN</code>, <code>DISCORD_GUILD_ID</code>, <code>DISCORD_SUBSCRIBER_ROLE_ID</code> in Vercel env vars.
                Bot must be in your server with &quot;Manage Roles&quot; permission.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  try {
                    const r = await authenticatedFetch('/api/admin/discord-role-sync', { method: 'POST' });
                    const d = await r.json() as { removed?: number; lapsed?: number; message?: string; error?: string };
                    if (r.ok) {
                      setToast({ type: 'saved', message: d.message ?? `Removed role from ${d.removed ?? 0} lapsed subscriber(s)` });
                    } else {
                      setToast({ type: 'error', message: d.error ?? 'Sync failed' });
                    }
                  } catch { setToast({ type: 'error', message: 'Sync failed' }); }
                  setTimeout(() => setToast(null), 4000);
                }}
              >
                💜 Remove lapsed subscriber roles
              </button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="integrations" title="🔌 Integrations">
            <div className="setting-group">
              <p className="input-hint" style={{ marginBottom: 16 }}>
                API keys are stored securely in the database and override any Vercel environment variables.
                Keys set here take effect immediately — no redeployment needed.
              </p>

              {/* Helper: key row */}
              {(
                [
                  {
                    field: 'rtirl_pull_key',
                    label: 'RTIRL pull key',
                    placeholder: 'Paste your RTIRL pull key…',
                    help: (
                      <>
                        Required for real-time location tracking on the overlay.{' '}
                        Get it from{' '}
                        <a href="https://rtirl.com/api" target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>
                          rtirl.com/api
                        </a>{' '}
                        → &quot;Pull keys&quot;. This is a read-only key — safe to keep here.
                      </>
                    ),
                  },
                  {
                    field: 'pulsoid_token',
                    label: 'Pulsoid access token',
                    placeholder: 'Paste your Pulsoid access token…',
                    help: (
                      <>
                        Required for heart-rate display. Get it from{' '}
                        <a href="https://pulsoid.net/ui/keys" target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>
                          pulsoid.net/ui/keys
                        </a>{' '}
                        → create a token with &quot;Heart rate read&quot; scope.
                      </>
                    ),
                  },
                  {
                    field: 'locationiq_key',
                    label: 'LocationIQ key',
                    placeholder: 'Paste your LocationIQ API key…',
                    help: (
                      <>
                        Used for reverse geocoding (converting GPS coords to place names). Free tier at{' '}
                        <a href="https://locationiq.com" target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>
                          locationiq.com
                        </a>{' '}
                        — 5,000 requests/day free. Optional if you don&apos;t show location names.
                      </>
                    ),
                  },
                  {
                    field: 'openweather_key',
                    label: 'OpenWeatherMap key',
                    placeholder: 'Paste your OpenWeatherMap API key…',
                    help: (
                      <>
                        Used for weather display and chat commands. Free tier at{' '}
                        <a href="https://openweathermap.org/api" target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>
                          openweathermap.org/api
                        </a>{' '}
                        — 60 calls/min free. Optional; weather features are disabled without it.
                      </>
                    ),
                  },
                ] as { field: string; label: string; placeholder: string; help: React.ReactNode }[]
              ).map(({ field, label, placeholder, help }) => {
                const status = apiKeyStatus[field];
                return (
                  <div key={field} style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span className="setting-label" style={{ marginBottom: 0 }}>{label}</span>
                      {status?.configured ? (
                        <span style={{ fontSize: 11, background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(16,185,129,0.3)' }}>
                          ✓ configured {status.source === 'env' ? '(env)' : '(db)'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.12)', color: '#f87171', padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(239,68,68,0.25)' }}>
                          not set
                        </span>
                      )}
                    </div>
                    {status?.masked && (
                      <p className="input-hint" style={{ marginBottom: 6, fontFamily: 'monospace', letterSpacing: 1 }}>
                        Current: {status.masked}
                      </p>
                    )}
                    <p className="input-hint" style={{ marginBottom: 8 }}>{help}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        className="text-input"
                        style={{ flex: 1, fontFamily: 'monospace' }}
                        placeholder={placeholder}
                        value={apiKeyInputs[field] ?? ''}
                        onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [field]: e.target.value }))}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={apiKeysSaving[field] || !apiKeyInputs[field]}
                        onClick={async () => {
                          setApiKeysSaving((prev) => ({ ...prev, [field]: true }));
                          try {
                            const r = await authenticatedFetch('/api/admin/api-keys', {
                              method: 'POST',
                              body: JSON.stringify({ [field]: apiKeyInputs[field] }),
                            });
                            if (r.ok) {
                              setApiKeyInputs((prev) => ({ ...prev, [field]: '' }));
                              // Refresh status
                              const fresh = await authenticatedFetch('/api/admin/api-keys').then((res) => res.json() as Promise<Record<string, ApiKeyStatus>>);
                              setApiKeyStatus(fresh);
                              setToast({ type: 'saved', message: `${label} saved` });
                            } else {
                              const d = await r.json() as { error?: string };
                              setToast({ type: 'error', message: d.error ?? 'Save failed' });
                            }
                          } catch { setToast({ type: 'error', message: 'Save failed' }); }
                          finally { setApiKeysSaving((prev) => ({ ...prev, [field]: false })); }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        {apiKeysSaving[field] ? 'Saving…' : 'Save'}
                      </button>
                      {status?.configured && status.source === 'db' && (
                        <button
                          type="button"
                          className="btn btn-danger btn-small"
                          disabled={apiKeysSaving[field]}
                          onClick={async () => {
                            if (!confirm(`Remove the saved ${label}?`)) return;
                            setApiKeysSaving((prev) => ({ ...prev, [field]: true }));
                            try {
                              await authenticatedFetch('/api/admin/api-keys', {
                                method: 'POST',
                                body: JSON.stringify({ [field]: '' }),
                              });
                              const fresh = await authenticatedFetch('/api/admin/api-keys').then((res) => res.json() as Promise<Record<string, ApiKeyStatus>>);
                              setApiKeyStatus(fresh);
                              setToast({ type: 'saved', message: `${label} removed` });
                            } catch { setToast({ type: 'error', message: 'Remove failed' }); }
                            finally { setApiKeysSaving((prev) => ({ ...prev, [field]: false })); }
                            setTimeout(() => setToast(null), 3000);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              <p className="input-hint" style={{ marginTop: 4 }}>
                Keys marked <code>(env)</code> come from Vercel environment variables and cannot be removed here — update them in your Vercel project settings.
                Keys marked <code>(db)</code> are stored in the database and override env vars.
              </p>
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
                  if (!confirm('Reset full stream session? Clears wallet, challenges, stream goals, timer, poll, trivia, and overlay alerts.')) return;
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

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="input-hint" style={{ marginBottom: 12 }}>
                <strong style={{ color: '#fbbf24' }}>One-time migration</strong> — copies credits and settings from Redis (KV) into Supabase.
                Safe to run multiple times (upserts). Run this once after deploying migration 005.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  if (!confirm('Migrate KV → Supabase? This copies credits, settings, and challenges. Safe to re-run.')) return;
                  setToast({ type: 'saved', message: 'Migrating… this may take a moment' });
                  try {
                    const r = await authenticatedFetch('/api/admin/migrate', { method: 'POST' });
                    const d = await r.json() as { message?: string; results?: Record<string, string>; error?: string };
                    if (r.ok) {
                      const summary = Object.entries(d.results ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
                      alert(`Migration complete:\n\n${summary}`);
                      setToast({ type: 'saved', message: 'Migration complete — see alert for details' });
                    } else {
                      setToast({ type: 'error', message: d.error ?? 'Migration failed' });
                    }
                  } catch { setToast({ type: 'error', message: 'Migration failed' }); }
                  setTimeout(() => setToast(null), 5000);
                }}
              >
                📦 Migrate KV → Supabase
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