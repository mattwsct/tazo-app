"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, MapZoomLevel, DisplayMode } from '@/types/settings';
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

/** Manual entry for body metrics from smart scales; data persists until overwritten (no TTL). */
const HEALTH_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'heightCm', label: 'Height', unit: 'cm' },
  { key: 'weightKg', label: 'Weight', unit: 'kg' },
  { key: 'bodyMassIndex', label: 'BMI', unit: '' },
  { key: 'bodyFatPercent', label: 'Body fat', unit: '%' },
  { key: 'leanBodyMassKg', label: 'Lean body mass', unit: 'kg' },
];

function HealthDataSection() {
  const [data, setData] = useState<Record<string, number | string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'saved' | 'error'; message: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/wellness', { credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        const out: Record<string, number | string> = {};
        for (const f of HEALTH_FIELDS) {
          const val = d[f.key];
          out[f.key] = typeof val === 'number' ? val : '';
        }
        out.updatedAt = d.updatedAt ?? 0;
        setData(out);
        setEdited({});
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to fetch' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = useCallback(async () => {
    const updates: Record<string, number> = {};
    for (const f of HEALTH_FIELDS) {
      const raw = edited[f.key] ?? (typeof data[f.key] === 'number' ? String(data[f.key]) : '');
      if (raw.trim() === '') continue;
      const n = parseFloat(raw);
      if (!Number.isNaN(n) && n >= 0) updates[f.key] = n;
    }
    if (Object.keys(updates).length === 0) {
      setToast({ type: 'error', message: 'Enter at least one value' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setSaving(true);
    try {
      const r = await authenticatedFetch('/api/wellness/update', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      if (r.ok) {
        setToast({ type: 'saved', message: 'Saved!' });
        fetchData();
      } else {
        const err = await r.json();
        setToast({ type: 'error', message: err.error ?? 'Save failed' });
      }
    } catch {
      setToast({ type: 'error', message: 'Save failed' });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 2500);
  }, [edited, data, fetchData]);

  if (loading) return <p className="input-hint">Loading health data…</p>;

  const fmt = (v: unknown) => (v === '' || v == null || v === 0 ? '' : String(v));
  const updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : 0;

  return (
    <div className="setting-group">
      <p className="input-hint" style={{ marginBottom: 12 }}>
        Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : 'Never'} · Edit and Save to add missing data.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px 20px', marginBottom: 16 }}>
        {HEALTH_FIELDS.map((f) => {
          const val = edited[f.key] ?? fmt(data[f.key]);
          return (
            <div key={f.key}>
              <label style={{ display: 'block', fontSize: '0.85em', marginBottom: 4, opacity: 0.9 }}>{f.label}</label>
              <input
                type="text"
                inputMode="decimal"
                value={val}
                onChange={(e) => setEdited((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder="—"
                className="admin-input"
                style={{ width: '100%', maxWidth: 120 }}
              />
              {f.unit && <span style={{ marginLeft: 4, fontSize: '0.85em', opacity: 0.7 }}>{f.unit}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary btn-small" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={fetchData}>
          🔄 Refresh
        </button>
        {toast && <span style={{ opacity: 0.9 }}>{toast.message}</span>}
      </div>
    </div>
  );
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
  const subGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalTargetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalIncrementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalIncrementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const kicksGoalSubtextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
  const [kickGiftSubShowLifetimeSubs, setKickGiftSubShowLifetimeSubs] = useState(true);
  const [kickChatBroadcastStreamTitle, setKickChatBroadcastStreamTitle] = useState(false);
  const [kickChatBroadcastLocation, setKickChatBroadcastLocation] = useState(false);
  const [kickChatBroadcastWeather, setKickChatBroadcastWeather] = useState(false);
  const [kickChatBroadcastHeartrate, setKickChatBroadcastHeartrate] = useState(false);
  const [kickChatBroadcastHeartrateMinBpm, setKickChatBroadcastHeartrateMinBpm] = useState(100);
  const [kickChatBroadcastHeartrateVeryHighBpm, setKickChatBroadcastHeartrateVeryHighBpm] = useState(120);
  const [kickChatBroadcastSpeed, setKickChatBroadcastSpeed] = useState(false);
  const [kickChatBroadcastSpeedMinKmh, setKickChatBroadcastSpeedMinKmh] = useState(20);
  const [kickChatBroadcastAltitude, setKickChatBroadcastAltitude] = useState(false);
  const [kickChatBroadcastAltitudeMinM, setKickChatBroadcastAltitudeMinM] = useState(50);
  const [kickChatBroadcastWellnessSteps, setKickChatBroadcastWellnessSteps] = useState(false);
  const [kickChatBroadcastWellnessDistance, setKickChatBroadcastWellnessDistance] = useState(false);
  const [kickChatBroadcastWellnessFlights, setKickChatBroadcastWellnessFlights] = useState(false);
  const [kickChatBroadcastWellnessActiveCalories, setKickChatBroadcastWellnessActiveCalories] = useState(false);
  const [kickStreamTitleCustom, setKickStreamTitleCustom] = useState('');
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
        if (d.alertSettings?.giftSubShowLifetimeSubs !== undefined) setKickGiftSubShowLifetimeSubs(d.alertSettings.giftSubShowLifetimeSubs);
        if (d.alertSettings?.chatBroadcastStreamTitle !== undefined) setKickChatBroadcastStreamTitle(d.alertSettings.chatBroadcastStreamTitle);
        if (d.alertSettings?.chatBroadcastLocation !== undefined) setKickChatBroadcastLocation(d.alertSettings.chatBroadcastLocation);
        if (d.alertSettings?.chatBroadcastWeather !== undefined) setKickChatBroadcastWeather(d.alertSettings.chatBroadcastWeather);
        if (d.alertSettings?.chatBroadcastHeartrate !== undefined) setKickChatBroadcastHeartrate(d.alertSettings.chatBroadcastHeartrate);
        if (d.alertSettings?.chatBroadcastHeartrateMinBpm != null) setKickChatBroadcastHeartrateMinBpm(d.alertSettings.chatBroadcastHeartrateMinBpm);
        if (d.alertSettings?.chatBroadcastHeartrateVeryHighBpm != null) setKickChatBroadcastHeartrateVeryHighBpm(d.alertSettings.chatBroadcastHeartrateVeryHighBpm);
        if (d.alertSettings?.chatBroadcastSpeed !== undefined) setKickChatBroadcastSpeed(d.alertSettings.chatBroadcastSpeed);
        if (d.alertSettings?.chatBroadcastSpeedMinKmh != null) setKickChatBroadcastSpeedMinKmh(d.alertSettings.chatBroadcastSpeedMinKmh);
        if (d.alertSettings?.chatBroadcastAltitude !== undefined) setKickChatBroadcastAltitude(d.alertSettings.chatBroadcastAltitude);
        if (d.alertSettings?.chatBroadcastAltitudeMinM != null) setKickChatBroadcastAltitudeMinM(d.alertSettings.chatBroadcastAltitudeMinM);
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
        if (d.settings) {
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
            autoUpdateLocation: kickStreamTitleAutoUpdate,
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
  }, [kickStatus?.connected, kickStreamTitleCustom, kickStreamTitleRawLocation, kickStreamTitleAutoUpdate, kickStreamTitleIncludeLocation, settings.locationDisplay, settings.customLocation]);

  const saveKickMessages = useCallback(async (overrides?: {
    messages?: KickMessageTemplates;
    enabled?: KickMessageEnabled;
    templateEnabled?: KickMessageTemplateEnabled;
    alertSettings?: Partial<{
      minimumKicks: number;
      giftSubShowLifetimeSubs: boolean;
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
      giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
      chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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
  }, [kickMessages, kickMessageEnabled, kickTemplateEnabled, kickMinimumKicks, kickGiftSubShowLifetimeSubs, kickChatBroadcastStreamTitle, kickChatBroadcastLocation, kickChatBroadcastWeather, kickChatBroadcastHeartrate, kickChatBroadcastHeartrateMinBpm, kickChatBroadcastHeartrateVeryHighBpm, kickChatBroadcastSpeed, kickChatBroadcastSpeedMinKmh, kickChatBroadcastAltitude, kickChatBroadcastAltitudeMinM, kickChatBroadcastWellnessSteps, kickChatBroadcastWellnessDistance, kickChatBroadcastWellnessFlights, kickChatBroadcastWellnessActiveCalories]);

  const kickAlertSettingsRef = useRef({
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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
    chatBroadcastWellnessSteps: kickChatBroadcastWellnessSteps,
    chatBroadcastWellnessDistance: kickChatBroadcastWellnessDistance,
    chatBroadcastWellnessActiveCalories: kickChatBroadcastWellnessActiveCalories,
  });
  kickAlertSettingsRef.current = {
    minimumKicks: kickMinimumKicks,
    giftSubShowLifetimeSubs: kickGiftSubShowLifetimeSubs,
    chatBroadcastStreamTitle: kickChatBroadcastStreamTitle,
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
  }, [settings.subGoalTarget, settings.kicksGoalTarget, settings.subGoalIncrement, settings.kicksGoalIncrement, settings.subGoalSubtext, settings.kicksGoalSubtext]);

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

  useEffect(() => {
    return () => {
      if (subGoalTargetTimeoutRef.current) clearTimeout(subGoalTargetTimeoutRef.current);
      if (kicksGoalTargetTimeoutRef.current) clearTimeout(kicksGoalTargetTimeoutRef.current);
      if (subGoalIncrementTimeoutRef.current) clearTimeout(subGoalIncrementTimeoutRef.current);
      if (kicksGoalIncrementTimeoutRef.current) clearTimeout(kicksGoalIncrementTimeoutRef.current);
      if (subGoalSubtextTimeoutRef.current) clearTimeout(subGoalSubtextTimeoutRef.current);
      if (kicksGoalSubtextTimeoutRef.current) clearTimeout(kicksGoalSubtextTimeoutRef.current);
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
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
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
                      <div className="admin-select-wrap" style={{ margin: 0 }}>
                        <select
                          aria-label="Connection actions"
                          className="admin-select-big btn btn-secondary btn-small"
                          style={{ padding: '6px 28px 6px 12px', minWidth: 180 }}
                          value=""
                          onChange={async (e) => {
                            const action = e.target.value;
                            if (!action) return;
                            (e.target as HTMLSelectElement).value = '';
                            if (action === 'fix') {
                              try {
                                const r = await fetch('/api/kick-oauth/subscribe', {
                                  method: 'POST',
                                  credentials: 'include',
                                });
                                const data = await r.json();
                                if (r.ok) {
                                  setToast({ type: 'saved', message: 'Connection fixed!' });
                                  fetch('/api/kick-oauth/status', { credentials: 'include' })
                                    .then((res) => res.json())
                                    .then(setKickStatus);
                                } else {
                                  const err = data.error ?? '';
                                  if (r.status === 400 || r.status === 401) {
                                    setToast({ type: 'error', message: 'Re-opening OAuth to reconnect…' });
                                    handleKickOAuthConnect();
                                  } else {
                                    setToast({ type: 'error', message: err || 'Fix failed' });
                                  }
                                }
                              } catch {
                                setToast({ type: 'error', message: 'Fix failed — try Reconnect (OAuth)' });
                                handleKickOAuthConnect();
                              }
                            } else if (action === 'subscribe') {
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
                                  setToast({ type: 'error', message: data.error ?? 'Re-subscribe failed' });
                                }
                              } catch {
                                setToast({ type: 'error', message: 'Re-subscribe failed' });
                              }
                            } else if (action === 'reconnect') {
                              handleKickOAuthConnect();
                            }
                            setTimeout(() => setToast(null), 3000);
                          }}
                        >
                          <option value="">Connection…</option>
                          <option value="fix">🔧 Fix connection</option>
                          <option value="subscribe">📡 Re-subscribe only</option>
                          <option value="reconnect">🔄 Reconnect (OAuth)</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        title="Clear leaderboard points only"
                        onClick={async () => {
                          if (!confirm('Reset leaderboard? This will clear all points. Steps, distance, and wellness are unchanged.')) return;
                          try {
                            const r = await authenticatedFetch('/api/reset-leaderboard', { method: 'POST' });
                            const data = await r.json();
                            if (r.ok) {
                              setToast({ type: 'saved', message: 'Leaderboard reset' });
                            } else {
                              setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                            }
                          } catch {
                            setToast({ type: 'error', message: 'Reset failed' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        🏆 Reset leaderboard
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        title="Reset steps, distance, flights for current stream — leaderboard unchanged"
                        onClick={async () => {
                          if (!confirm('Reset stream session? Clears leaderboard, steps, distance, flights, stream goals, and wellness milestones. Use when auto-reset fails or for a clean start.')) return;
                          try {
                            const r = await authenticatedFetch('/api/reset-stream-session', { method: 'POST' });
                            const data = await r.json();
                            if (r.ok) {
                              setToast({ type: 'saved', message: 'Stream session reset' });
                            } else {
                              setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                            }
                          } catch {
                            setToast({ type: 'error', message: 'Reset failed' });
                          }
                          setTimeout(() => setToast(null), 3000);
                        }}
                      >
                        🔄 Reset stream session
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="kick-status disconnected">
                    <span className="status-dot">🔴</span>
                    <span>Not connected to Kick</span>
                    <p className="input-hint" style={{ marginTop: 8, marginBottom: 12 }}>
                      Connect to receive subs, gifts, kicks, poll votes, and chat events. Required for stream title, poll, and message templates.
                    </p>
                    <button
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
              <p className="input-hint" style={{ marginTop: 4, fontSize: '0.85em' }}>
                One setting for all. Custom = your text on overlay + stream title. Hidden = no location, no map.
              </p>
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
              {settings.locationDisplay === 'hidden' && (
                <p className="input-hint" style={{ marginBottom: 8, fontSize: '0.85em' }}>
                  Map is hidden when location is Hidden (one setting).
                </p>
              )}
              <div className="admin-select-wrap" style={{ opacity: settings.locationDisplay === 'hidden' ? 0.6 : 1 }}>
                <label>Map display (when location not Hidden)</label>
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
                    🏃 On movement
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
              <div className="admin-select-wrap">
                <label>Map zoom</label>
                <div className="option-buttons" role="group" aria-label="Map zoom">
                  {(['match', 'ocean', 'continental'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`option-btn ${settings.mapZoomLevel === level ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ mapZoomLevel: level })}
                    >
                      {level === 'match' && '📍 Same as location'}
                      {level === 'ocean' && '🌊 Ocean'}
                      {level === 'continental' && '🌎 Continental'}
                    </button>
                  ))}
                </div>
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
          </CollapsibleSection>

          {/* Stream title & chat broadcasts */}
          <CollapsibleSection id="stream-title" title="📺 Stream title & chat broadcasts">
            <div className="setting-group">
              <h3 className="subsection-label">Stream title</h3>
              <p className="group-label group-description">
                Custom title + location (flag as separator). <strong>Fetch current</strong> (when live) parses from Kick. Auto-push only when <strong>live</strong>. If you get 401, use <strong>Fix connection</strong> or <strong>Reconnect (OAuth)</strong> in Kick connection above.
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
                <p className="input-hint" style={{ marginBottom: '8px', fontSize: '0.85em' }}>
                  Same setting as overlay: Custom = your custom text; Hidden = no location, no minimap.
                </p>
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
                  Auto-push stream title when live and location changes (server cron every 2 min)
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
                    checked={kickChatBroadcastStreamTitle}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setKickChatBroadcastStreamTitle(checked);
                      saveKickMessages({ alertSettings: { chatBroadcastStreamTitle: checked } });
                    }}
                    className="checkbox-input"
                  />
                  <span className="radio-icon" aria-hidden="true">📺</span>
                  <span>Stream title</span>
                </label>
                {kickChatBroadcastStreamTitle && (
                  <div className="broadcast-option-detail">
                    <span className="checkbox-label-row-sm" style={{ opacity: 0.9 }}>Posts &quot;Stream title updated to X&quot; when you update manually or when auto-push runs</span>
            </div>
                )}
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
                            scheduleKickMessagesSave();
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
                            scheduleKickMessagesSave();
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
                            scheduleKickMessagesSave();
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
                            scheduleKickMessagesSave();
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
              <div className="broadcast-option-block" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="checkbox-label-row-sm" style={{ opacity: 0.9, marginBottom: '8px', display: 'block' }}>Wellness milestones (Health Auto Export) — chat when crossing thresholds this stream:</span>
                <div className="form-row-wrap" style={{ gap: '12px 24px' }}>
                  <label className="checkbox-label-row broadcast-checkbox-item">
                    <input type="checkbox" checked={kickChatBroadcastWellnessSteps} onChange={(e) => { const c = e.target.checked; setKickChatBroadcastWellnessSteps(c); saveKickMessages({ alertSettings: { chatBroadcastWellnessSteps: c } }); }} className="checkbox-input" />
                    <span className="radio-icon">👟</span>
                    <span>Steps</span>
                  </label>
                  <label className="checkbox-label-row broadcast-checkbox-item">
                    <input type="checkbox" checked={kickChatBroadcastWellnessDistance} onChange={(e) => { const c = e.target.checked; setKickChatBroadcastWellnessDistance(c); saveKickMessages({ alertSettings: { chatBroadcastWellnessDistance: c } }); }} className="checkbox-input" />
                    <span className="radio-icon">🚶</span>
                    <span>Distance (km)</span>
                  </label>
                  <label className="checkbox-label-row broadcast-checkbox-item">
                    <input type="checkbox" checked={kickChatBroadcastWellnessFlights} onChange={(e) => { const c = e.target.checked; setKickChatBroadcastWellnessFlights(c); saveKickMessages({ alertSettings: { chatBroadcastWellnessFlights: c } }); }} className="checkbox-input" />
                    <span className="radio-icon">🪜</span>
                    <span>Flights climbed</span>
                  </label>
                  <label className="checkbox-label-row broadcast-checkbox-item">
                    <input type="checkbox" checked={kickChatBroadcastWellnessActiveCalories} onChange={(e) => { const c = e.target.checked; setKickChatBroadcastWellnessActiveCalories(c); saveKickMessages({ alertSettings: { chatBroadcastWellnessActiveCalories: c } }); }} className="checkbox-input" />
                    <span className="radio-icon">🔥</span>
                    <span>Active calories</span>
                  </label>
                </div>
              </div>
            </div>
            </div>
          </CollapsibleSection>

          {/* === OVERLAY === */}
          {/* Top-left & top-right rotating slots — consolidated */}
          <CollapsibleSection
            id="overlay-top-rotation"
            title="🔄 Overlay: top-left & top-right rotation"
            description={
              <>
                Top-left rotates Date → Steps → Distance every 7s. Top-right rotates Temp → Condition → Altitude → Speed. Enable/configure what appears in each.
              </>
            }
          >
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
                  <span className="checkbox-text">Steps</span>
                </label>
            </div>
              <p className="input-hint" style={{ fontSize: '0.85em', marginTop: 4 }}>
                Date from timezone. All rotate every 7s.
              </p>
            </div>
            
            <div className="setting-group" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 className="subsection-label" style={{ marginBottom: 8 }}>Top-right (location data)</h4>
              <div className="checkbox-group" style={{ marginBottom: 12 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showWeather ?? false}
                    onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Temp</span>
                </label>
              </div>
              {settings.showWeather && (
                <div className="admin-select-wrap" style={{ marginBottom: 12 }}>
                  <label>Weather conditions</label>
                  <div className="option-buttons" role="group">
                    {(['always', 'auto', 'hidden'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`option-btn ${(settings.weatherConditionDisplay || 'auto') === mode ? 'active' : ''}`}
                        onClick={() => handleSettingsChange({ weatherConditionDisplay: mode })}
                      >
                        {mode === 'always' && '👁️ Always'}
                        {mode === 'auto' && '🌧️ Auto'}
                        {mode === 'hidden' && '🚫 Hidden'}
                      </button>
                    ))}
            </div>
            </div>
              )}
              <p className="input-hint" style={{ fontSize: '0.85em', marginTop: 8 }}>
                Altitude & speed auto-show when notable (e.g. climb/descent, moving) and hide when no longer relevant.
              </p>
            </div>
          </CollapsibleSection>

          {/* Leaderboard & Overlay Alerts */}
          <CollapsibleSection
            id="leaderboard-alerts"
            title="📊 Overlay: leaderboard, goals & alerts"
            description={
              <>
                <strong>How it works:</strong> The bottom-right shows one thing at a time, rotating every 7 seconds — Leaderboard → Chips → Sub goal → Kicks goal (only what you enable below). New sub or kicks? It switches instantly to that goal. Alerts (subs, gifts, kicks) appear above the rotating display.
              </>
            }
          >
            <div className="setting-group">
              <p className="input-hint" style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.06)', borderRadius: 8 }}>
                Enable leaderboard and/or goals below. Each rotates into view for 7 seconds. Sub/kicks goals switch immediately when someone subs or donates.
              </p>
              <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.showGoalsRotation !== false}
                    onChange={(e) => handleSettingsChange({ showGoalsRotation: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show rotating section — when off, carousel is hidden but sub/kicks alerts still pop up in progress bars</span>
                </label>
            </div>
              <div className="admin-select-wrap" style={{ marginBottom: '12px' }}>
                <label>Leaderboard — include in rotation?</label>
                <select
                  className="admin-select-big"
                  value={settings.showLeaderboard !== false ? 'true' : 'false'}
                  onChange={(e) => handleSettingsChange({ showLeaderboard: e.target.value === 'true' })}
                >
                  <option value="true">👁️ Yes, include in rotation</option>
                  <option value="false">🚫 No, hidden</option>
                </select>
              </div>
              {settings.showLeaderboard !== false && (
                <>
                  <div className="admin-select-wrap">
                    <label>Top N users</label>
                    <select
                      className="admin-select-big"
                      value={settings.leaderboardTopN ?? 5}
                      onChange={(e) => handleSettingsChange({ leaderboardTopN: Number(e.target.value) })}
                    >
                      {[1, 3, 5, 10].map((n) => (
                        <option key={n} value={n}>Top {n}</option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-select-wrap">
                    <label>Usernames to exclude from leaderboard (comma or newline separated)</label>
                    <textarea
                      className="text-input"
                      value={leaderboardExcludedBotsInput}
                      onChange={(e) => handleLeaderboardExcludedBotsChange(e.target.value)}
                      placeholder="e.g. nightbot, moobot, streamelements"
                      rows={2}
                      style={{ resize: 'vertical', minHeight: 50 }}
                    />
                    <p className="input-hint" style={{ marginTop: 4, fontSize: '0.85em' }}>
                      Add bots, your own username, or anyone who should not appear or earn points
                    </p>
            </div>
                </>
              )}
              <div className="checkbox-group" style={{ marginTop: '16px', marginBottom: '12px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.gamblingEnabled !== false}
                    onChange={(e) => handleSettingsChange({ gamblingEnabled: e.target.checked })}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Enable blackjack (gambling chips)</span>
                </label>
                <p className="input-hint" style={{ marginTop: 4, fontSize: '0.85em' }}>
                  When off, !deal/!chips/!hit etc. are disabled and the chips leaderboard is hidden
                </p>
              </div>
              {settings.gamblingEnabled !== false && (
              <div className="admin-select-wrap" style={{ marginTop: '12px', marginBottom: '12px' }}>
                <label>Gambling (chips) leaderboard — include in rotation?</label>
                <select
                  className="admin-select-big"
                  value={settings.showGamblingLeaderboard === true ? 'true' : 'false'}
                  onChange={(e) => handleSettingsChange({ showGamblingLeaderboard: e.target.value === 'true' })}
                >
                  <option value="true">🃏 Yes, include in rotation</option>
                  <option value="false">🚫 No, hidden</option>
                </select>
            </div>
              )}
              {settings.gamblingEnabled !== false && settings.showGamblingLeaderboard === true && (
                <div className="admin-select-wrap">
                  <label>Top N chips</label>
                  <select
                    className="admin-select-big"
                    value={settings.gamblingLeaderboardTopN ?? 5}
                    onChange={(e) => handleSettingsChange({ gamblingLeaderboardTopN: Number(e.target.value) })}
                  >
                    {[1, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>Top {n}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="checkbox-group" style={{ marginTop: '16px', marginBottom: '12px' }}>
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
                      <input
                        type="number"
                        className="text-input admin-select-big"
                        value={subGoalTargetInput}
                        onChange={(e) => handleSubGoalTargetChange(e.target.value)}
                        min={1}
                      />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Auto-increment amount (when goal is reached)</label>
                      <input
                        type="number"
                        className="text-input admin-select-big"
                        value={subGoalIncrementInput}
                        onChange={(e) => handleSubGoalIncrementChange(e.target.value)}
                        min={1}
                      />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Sub goal subtext (optional second line)</label>
                <input
                  type="text"
                        className="text-input admin-select-big"
                        value={subGoalSubtextInput}
                        onChange={(e) => handleSubGoalSubtextChange(e.target.value)}
                        placeholder="e.g. 10 subs = 10 min extra stream"
                      />
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
                      <input
                        type="number"
                        className="text-input admin-select-big"
                        value={kicksGoalTargetInput}
                        onChange={(e) => handleKicksGoalTargetChange(e.target.value)}
                        min={1}
                      />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Auto-increment amount (when goal is reached)</label>
                      <input
                        type="number"
                        className="text-input admin-select-big"
                        value={kicksGoalIncrementInput}
                        onChange={(e) => handleKicksGoalIncrementChange(e.target.value)}
                        min={1}
                      />
                    </div>
                    <div className="admin-select-wrap" style={{ marginTop: 8 }}>
                      <label>Kicks goal subtext (optional second line)</label>
                      <input
                        type="text"
                        className="text-input admin-select-big"
                        value={kicksGoalSubtextInput}
                        onChange={(e) => handleKicksGoalSubtextChange(e.target.value)}
                        placeholder="e.g. Help me hit $50!"
                      />
                    </div>
                  </div>
                )}
                {(settings.showSubGoal || settings.showKicksGoal) && (
                  <div className="stream-goals-override" style={{ marginLeft: '24px', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                    <p className="input-hint">
                      Goals reset to 0 when stream goes live (manual overrides reset too). Override current values:
                    </p>
                    <div className="stream-goals-override-fields">
                      {settings.showSubGoal && (
                        <div className="admin-select-wrap">
                          <label>Current subs</label>
                          <input
                            key={`subs-${settings.streamGoals?.subs ?? 0}`}
                            type="number"
                            className="text-input admin-select-big admin-number-input"
                            defaultValue={settings.streamGoals?.subs ?? 0}
                            id="stream-goals-subs-input"
                            min={0}
                          />
                        </div>
                      )}
                      {settings.showKicksGoal && (
                        <div className="admin-select-wrap">
                          <label>Current kicks</label>
                          <input
                            key={`kicks-${settings.streamGoals?.kicks ?? 0}`}
                            type="number"
                            className="text-input admin-select-big admin-number-input"
                            defaultValue={settings.streamGoals?.kicks ?? 0}
                            id="stream-goals-kicks-input"
                            min={0}
                          />
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
              <div className="checkbox-group" style={{ marginTop: '16px', marginBottom: '12px' }}>
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

          <CollapsibleSection id="poll" title="🗳️ Poll">
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
                      </>
                    )}
                  </div>
                </div>
          </CollapsibleSection>

          <CollapsibleSection id="message-templates" title="📋 Chat message templates">
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
          </CollapsibleSection>

          <CollapsibleSection id="health-data" title="⚖️ Body metrics (manual entry)" description="Weight and BMI — add missing data before your smart scale or Health Auto Export sends it.">
            <HealthDataSection />
          </CollapsibleSection>

          <CollapsibleSection id="advanced-data" title="⚙️ Advanced / Data" defaultCollapsed={true} description="Less frequently used data reset options.">
            <div className="setting-group">
              <p className="input-hint" style={{ marginBottom: 12 }}>
                Reset specific data stores. Use when auto-reset fails or for targeted cleanup.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                title="Reset wellness milestones only"
                onClick={async () => {
                  if (!confirm('Reset wellness milestones? Leaderboard, steps, distance unchanged.')) return;
                  try {
                    const r = await authenticatedFetch('/api/reset-wellness-session', { method: 'POST' });
                    const data = await r.json();
                    if (r.ok) {
                      setToast({ type: 'saved', message: 'Wellness milestones reset' });
                    } else {
                      setToast({ type: 'error', message: data.error ?? 'Reset failed' });
                    }
                  } catch {
                    setToast({ type: 'error', message: 'Reset failed' });
                  }
                  setTimeout(() => setToast(null), 3000);
                }}
              >
                🧘 Reset wellness
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