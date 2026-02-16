"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, MapZoomLevel, DisplayMode, TodoItem } from '@/types/settings';
import {
  DEFAULT_KICK_MESSAGES,
  KICK_MESSAGE_KEYS,
  KICK_EVENT_TOGGLE_KEYS,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled } from '@/types/kick-messages';
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
  channelRewardDeclined: 'Channel reward (declined)',
};

const KICK_TOGGLE_LABELS: Record<keyof KickMessageEnabled, string> = {
  follow: 'Follow alerts',
  newSub: 'New sub alerts',
  resub: 'Resub alerts',
  giftSub: 'Gift sub alerts',
  kicksGifted: 'Kicks gifted alerts',
  channelReward: 'Channel reward alerts',
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

  // Todo editing state
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');

  // Kick bot state
  const [kickStatus, setKickStatus] = useState<{ connected: boolean; subscriptions?: unknown[] } | null>(null);
  const [kickWebhookLog, setKickWebhookLog] = useState<{ eventType: string; at: string }[]>([]);
  const [kickWebhookDebug, setKickWebhookDebug] = useState<{
    at: string;
    eventType: string;
    bodyLen: number;
    hasSig: boolean;
    hasMsgId: boolean;
    hasTs: boolean;
    verified: boolean;
  } | null>(null);
  const [kickMessages, setKickMessages] = useState<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const [kickMessageEnabled, setKickMessageEnabled] = useState<KickMessageEnabled>(DEFAULT_KICK_MESSAGE_ENABLED);
  const [kickTestMessage, setKickTestMessage] = useState('');
  const [kickTestSending, setKickTestSending] = useState(false);
  const [kickTemplateTesting, setKickTemplateTesting] = useState<keyof KickMessageTemplates | null>(null);
  const [kickApiResult, setKickApiResult] = useState<{ action: string; data: unknown } | null>(null);
  const [kickApiLoading, setKickApiLoading] = useState(false);
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
      setToast({ type: 'saved', message: 'Kick bot connected successfully!' });
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
      })
      .catch(() => {});
    fetch('/api/kick-webhook-log', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setKickWebhookLog(d.log ?? []);
        setKickWebhookDebug(d.debug ?? null);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const handleKickMessageChange = useCallback((key: keyof KickMessageTemplates, value: string) => {
    setKickMessages((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleKickToggleChange = useCallback(
    async (key: keyof KickMessageEnabled, value: boolean) => {
      const next = { ...kickMessageEnabled, [key]: value };
      setKickMessageEnabled(next);
      try {
        await authenticatedFetch('/api/kick-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        });
      } catch {
        setKickMessageEnabled((prev) => ({ ...prev, [key]: !value }));
      }
    },
    [kickMessageEnabled]
  );

  const kickApiCall = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      setKickApiLoading(true);
      setKickApiResult(null);
      try {
        const r = await authenticatedFetch('/api/kick-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...params }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          setKickApiResult({ action, data });
        } else {
          setKickApiResult({ action, data: { error: data.error ?? 'Request failed' } });
        }
      } catch {
        setKickApiResult({ action, data: { error: 'Network error' } });
      }
      setKickApiLoading(false);
    },
    []
  );

  const saveKickMessages = useCallback(async () => {
    setToast({ type: 'saving', message: 'Saving messages...' });
    try {
      const r = await authenticatedFetch('/api/kick-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: kickMessages, enabled: kickMessageEnabled }),
      });
      if (r.ok) {
        setToast({ type: 'saved', message: 'Messages saved!' });
      } else {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save');
      }
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
    }
    setTimeout(() => setToast(null), 3000);
  }, [kickMessages, kickMessageEnabled]);

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
        setToast({ type: 'saved', message: 'Test message sent to kick.com/tazo!' });
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
          body: JSON.stringify({ templateKey: key, templates: kickMessages }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          setToast({ type: 'saved', message: `${KICK_MESSAGE_LABELS[key]} test sent!` });
        } else {
          throw new Error(data.error ?? 'Failed to send');
        }
      } catch (err) {
        setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send' });
      }
      setTimeout(() => setToast(null), 3000);
      setKickTemplateTesting(null);
    },
    [kickMessages]
  );

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
    setToast({ type: 'saving', message: 'Saving settings...' });
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
      
      setToast({ type: 'saved', message: 'Settings saved successfully!' });
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
            <section className="settings-section kick-bot-tab">
              <div className="section-header">
                <h2>🤖 Kick Bot</h2>
              </div>

              {/* Connection */}
              <div className="setting-group">
                <label className="group-label">Connection</label>
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
                        onClick={() => {
                          const popup = window.open('/api/kick-oauth/authorize', 'kick_oauth', 'width=500,height=600');
                          const handler = (e: MessageEvent) => {
                            if (e.origin !== window.location.origin || e.data?.type !== 'kick_oauth_complete') return;
                            clearInterval(poll);
                            window.removeEventListener('message', handler);
                            if (e.data.error) setToast({ type: 'error', message: e.data.error });
                            else setToast({ type: 'saved', message: 'Kick connected!' });
                            fetch('/api/kick-oauth/status', { credentials: 'include' }).then((r) => r.json()).then(setKickStatus);
                            setTimeout(() => setToast(null), 3000);
                          };
                          const poll = setInterval(() => {
                            if (popup?.closed) { clearInterval(poll); window.removeEventListener('message', handler); }
                          }, 500);
                          window.addEventListener('message', handler);
                        }}
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
                              setToast({ type: 'saved', message: 'Re-subscribed to events!' });
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
                      className="btn btn-primary"
                      style={{ marginTop: '8px' }}
                      onClick={() => {
                        const popup = window.open('/api/kick-oauth/authorize', 'kick_oauth', 'width=500,height=600');
                        const handler = (e: MessageEvent) => {
                          if (e.origin !== window.location.origin || e.data?.type !== 'kick_oauth_complete') return;
                          clearInterval(poll);
                          window.removeEventListener('message', handler);
                          if (e.data.error) setToast({ type: 'error', message: e.data.error });
                          else setToast({ type: 'saved', message: 'Kick connected!' });
                          fetch('/api/kick-oauth/status', { credentials: 'include' }).then((r) => r.json()).then(setKickStatus);
                          setTimeout(() => setToast(null), 3000);
                        };
                        const poll = setInterval(() => {
                          if (popup?.closed) { clearInterval(poll); window.removeEventListener('message', handler); }
                        }, 500);
                        window.addEventListener('message', handler);
                      }}
                    >
                      Connect Kick
                    </button>
                  </div>
                )}
              </div>

              {/* Webhook activity */}
              <div className="setting-group">
                <label className="group-label">Webhook activity</label>
                {kickWebhookDebug && (
                  <div
                    className="kick-webhook-debug"
                    style={{
                      marginBottom: '12px',
                      padding: '10px 12px',
                      background: kickWebhookDebug.verified ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                      borderRadius: 8,
                      fontSize: '0.85rem',
                    }}
                  >
                    <strong>Last request received</strong> {new Date(kickWebhookDebug.at).toLocaleString()}
                    <br />
                    <code>{kickWebhookDebug.eventType}</code> · body: {kickWebhookDebug.bodyLen}B
                    {kickWebhookDebug.hasSig ? ' · sig ✓' : ' · no sig'}
                    {kickWebhookDebug.hasMsgId ? ' · msgId ✓' : ' · no msgId'}
                    {kickWebhookDebug.hasTs ? ' · ts ✓' : ' · no ts'}
                    <br />
                    {kickWebhookDebug.verified ? (
                      <span style={{ color: 'rgb(34,197,94)' }}>Signature verified ✓</span>
                    ) : (
                      <span style={{ color: 'rgb(234,179,8)' }}>Signature failed — check secret / payload order</span>
                    )}
                  </div>
                )}
                <p className="group-label" style={{ marginBottom: '8px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  {kickWebhookLog.length === 0
                    ? 'No webhooks received yet. Kick may not send chat events when the streamer posts — try having a viewer type !ping or !test.'
                    : `Last ${kickWebhookLog.length} webhook(s):`}
                </p>
                {kickWebhookLog.length > 0 && (
                  <div className="kick-webhook-log">
                    {kickWebhookLog.map((e, i) => (
                      <div key={i} className="kick-webhook-log-entry">
                        <code>{e.eventType}</code>
                        <span className="kick-webhook-log-time">{new Date(e.at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  style={{ marginTop: '8px' }}
                  onClick={() =>
                    fetch('/api/kick-webhook-log', { credentials: 'include' })
                      .then((r) => r.json())
                      .then((d) => {
                        setKickWebhookLog(d.log ?? []);
                        setKickWebhookDebug(d.debug ?? null);
                      })
                  }
                >
                  Refresh
                </button>
              </div>

              {/* Chat commands */}
              <div className="setting-group">
                <label className="group-label">Chat commands</label>
                <p className="group-label" style={{ marginBottom: '8px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  Type <code>!ping</code> or <code>!test</code> (bot check), <code>!location</code>, <code>!weather</code>, <code>!time</code>. Kick may not send webhooks for the streamer&apos;s own messages — have a viewer test.
                </p>
                <div className="kick-commands-list">
                  <code>!ping</code> / <code>!test</code> <span className="kick-cmd-desc">— Pong!</span><br />
                  <code>!location</code> <span className="kick-cmd-desc">— current location</span><br />
                  <code>!weather</code> <span className="kick-cmd-desc">— temp, conditions</span><br />
                  <code>!time</code> <span className="kick-cmd-desc">— local time</span>
                </div>
              </div>

              {/* Test Message */}
              <div className="setting-group">
                <label className="group-label">Send test message</label>
                <p className="group-label" style={{ marginBottom: '8px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
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

              {/* Message templates */}
              <div className="setting-group">
                <label className="group-label">Chat message templates</label>
                <p className="group-label" style={{ marginBottom: '8px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  Toggle which events trigger a chat message:
                </p>
                <div className="kick-toggles-row" style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
                  {KICK_EVENT_TOGGLE_KEYS.map((key) => (
                    <label key={key} className="kick-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="checkbox"
                        checked={kickMessageEnabled[key] !== false}
                        onChange={(e) => handleKickToggleChange(key, e.target.checked)}
                      />
                      {KICK_TOGGLE_LABELS[key]}
                    </label>
                  ))}
                </div>
                <p className="group-label" style={{ marginBottom: '12px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  Use placeholders like {'{name}'}, {'{gifter}'}, {'{months}'}, {'{count}'}, {'{sender}'}, {'{amount}'}, {'{redeemer}'}, {'{title}'}, {'{userInput}'}, {'{message}'}.
                </p>
                <div className="kick-messages-grid">
                  {KICK_MESSAGE_KEYS.map((key) => (
                    <div key={key} className="kick-message-field">
                      <label className="kick-message-label">{KICK_MESSAGE_LABELS[key]}</label>
                      <div className="kick-message-row">
                        <input
                          type="text"
                          className="text-input"
                          value={kickMessages[key]}
                          onChange={(e) => handleKickMessageChange(key, e.target.value)}
                          placeholder={DEFAULT_KICK_MESSAGES[key]}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary kick-test-btn"
                          onClick={() => sendKickTemplateTest(key)}
                          disabled={!kickStatus?.connected || kickTemplateTesting === key}
                          title="Send test to Kick chat"
                        >
                          {kickTemplateTesting === key ? 'Sending…' : 'Test'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary" onClick={saveKickMessages}>
                    Save messages
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setKickMessages(DEFAULT_KICK_MESSAGES);
                    }}
                  >
                    Reset to defaults
                  </button>
                </div>

                {/* Suggested additions */}
                <details className="kick-suggested-additions" style={{ marginTop: '20px', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 500, opacity: 0.9 }}>Possible future message types</summary>
                  <ul style={{ margin: '12px 0 0 0', paddingLeft: '20px', opacity: 0.9, fontSize: '0.9rem', lineHeight: 1.7 }}>
                    <li><strong>Stream started/ended</strong> — Kick has <code>livestream.status.updated</code>. Add subscription + templates for &quot;Stream starting!&quot; / &quot;Thanks for watching!&quot;</li>
                    <li><strong>Top gifter (weekly/monthly/all-time)</strong> — No dedicated webhook. Would need leaderboard polling (GET /kicks/leaderboard) or a Kick feature request.</li>
                    <li><strong>Gift sub milestone</strong> — &quot;X gifted 10 subs!&quot; — use existing <code>channel.subscription.gifts</code> and add logic when count ≥ threshold.</li>
                    <li><strong>Moderation banned</strong> — Kick has <code>moderation.banned</code>. e.g. &quot;{'{banned_user}'} was banned. Reason: {'{reason}'}&quot;</li>
                    <li><strong>First-time chatter</strong> — No webhook; would need to track chatters yourself from <code>chat.message.sent</code>.</li>
                    <li><strong>Viewer milestone</strong> — e.g. &quot;100 viewers!&quot; — would need livestream viewer count polling.</li>
                  </ul>
                </details>
              </div>

              {/* Kick API Playground */}
              <div className="setting-group">
                <label className="group-label">Kick API Playground</label>
                <p className="group-label" style={{ marginBottom: '12px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  Call Kick API endpoints. Reconnect to grant new scopes (channel:write, channel:rewards:write, kicks:read, moderation:ban) if needed.
                </p>
                {kickApiLoading && <p style={{ opacity: 0.8, fontSize: '0.9rem' }}>Loading…</p>}
                {kickApiResult && (
                  <pre className="kick-api-result" style={{ marginBottom: '16px', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, fontSize: '0.8rem', overflow: 'auto', maxHeight: 300 }}>
                    {JSON.stringify(kickApiResult.data, null, 2)}
                  </pre>
                )}

                <div className="kick-api-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Channel */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Channel</summary>
                    <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getChannel')} disabled={!kickStatus?.connected || kickApiLoading}>GET Channel</button>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input type="text" className="text-input" placeholder="Stream title" id="patch-title" style={{ width: 180 }} />
                        <input type="number" className="text-input" placeholder="Category ID" id="patch-category" style={{ width: 100 }} />
                        <input type="text" className="text-input" placeholder="Tags (comma)" id="patch-tags" style={{ width: 140 }} />
                        <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('patchChannel', { body: { stream_title: (document.getElementById('patch-title') as HTMLInputElement)?.value || undefined, category_id: parseInt((document.getElementById('patch-category') as HTMLInputElement)?.value || '0') || undefined, custom_tags: (document.getElementById('patch-tags') as HTMLInputElement)?.value?.split(',').map((t) => t.trim()).filter(Boolean) || undefined } })} disabled={!kickStatus?.connected || kickApiLoading}>PATCH Channel</button>
                      </div>
                    </div>
                  </details>

                  {/* Livestreams */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Livestreams</summary>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getLivestreams')} disabled={!kickStatus?.connected || kickApiLoading}>GET Livestreams</button>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getLivestreamStats')} disabled={!kickStatus?.connected || kickApiLoading}>GET Stats</button>
                    </div>
                  </details>

                  {/* Rewards */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Channel Rewards</summary>
                    <div style={{ marginTop: '12px' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getRewards')} disabled={!kickStatus?.connected || kickApiLoading}>GET Rewards</button>
                    </div>
                  </details>

                  {/* Redemptions */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Reward Redemptions</summary>
                    <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <select id="redemption-status" className="text-input" style={{ width: 120 }}>
                        <option value="pending">pending</option>
                        <option value="accepted">accepted</option>
                        <option value="rejected">rejected</option>
                      </select>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getRedemptions', { query: { status: (document.getElementById('redemption-status') as HTMLSelectElement)?.value || 'pending' } })} disabled={!kickStatus?.connected || kickApiLoading}>GET Redemptions</button>
                      <input type="text" className="text-input" placeholder="Redemption IDs (comma)" id="redemption-ids" style={{ width: 200 }} />
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('acceptRedemptions', { ids: (document.getElementById('redemption-ids') as HTMLInputElement)?.value?.split(',').map((i) => i.trim()).filter(Boolean) })} disabled={!kickStatus?.connected || kickApiLoading}>Accept</button>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('rejectRedemptions', { ids: (document.getElementById('redemption-ids') as HTMLInputElement)?.value?.split(',').map((i) => i.trim()).filter(Boolean) })} disabled={!kickStatus?.connected || kickApiLoading}>Reject</button>
                    </div>
                  </details>

                  {/* Leaderboard */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Kicks Leaderboard</summary>
                    <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getLeaderboard', { query: { top: 10 } })} disabled={!kickStatus?.connected || kickApiLoading}>GET Leaderboard (top 10)</button>
                    </div>
                  </details>

                  {/* Categories */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Categories</summary>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="text" className="text-input" placeholder="Search by name" id="category-name" style={{ width: 160 }} />
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getCategories', { query: { name: (document.getElementById('category-name') as HTMLInputElement)?.value || '', limit: 20 } })} disabled={!kickStatus?.connected || kickApiLoading}>Search</button>
                      <input type="number" className="text-input" placeholder="Category ID" id="category-id" style={{ width: 90 }} />
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getCategory', { category_id: (document.getElementById('category-id') as HTMLInputElement)?.value })} disabled={!kickStatus?.connected || kickApiLoading}>GET by ID</button>
                    </div>
                  </details>

                  {/* Moderation */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Moderation (Ban / Unban)</summary>
                    <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <input type="number" className="text-input" placeholder="User ID to ban" id="ban-user-id" style={{ width: 110 }} />
                      <input type="number" className="text-input" placeholder="Duration (min, omit=permanent)" id="ban-duration" style={{ width: 90 }} />
                      <input type="text" className="text-input" placeholder="Reason" id="ban-reason" style={{ width: 120 }} />
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('postBan', { body: { user_id: parseInt((document.getElementById('ban-user-id') as HTMLInputElement)?.value || '0'), duration: parseInt((document.getElementById('ban-duration') as HTMLInputElement)?.value || '0') || undefined, reason: (document.getElementById('ban-reason') as HTMLInputElement)?.value || undefined } })} disabled={!kickStatus?.connected || kickApiLoading}>Ban</button>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('deleteBan', { body: { user_id: parseInt((document.getElementById('ban-user-id') as HTMLInputElement)?.value || '0') } })} disabled={!kickStatus?.connected || kickApiLoading}>Unban</button>
                    </div>
                    <p style={{ marginTop: 8, fontSize: '0.8rem', opacity: 0.8 }}>Broadcaster ID is inferred from your token. Get user_id from channel/chat or users API.</p>
                  </details>

                  {/* Users */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Users</summary>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input type="text" className="text-input" placeholder="User IDs (comma)" id="user-ids" style={{ width: 180 }} />
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getUsers', { query: { id: (document.getElementById('user-ids') as HTMLInputElement)?.value?.split(',').map((i) => i.trim()).filter(Boolean) } })} disabled={!kickStatus?.connected || kickApiLoading}>GET Users</button>
                    </div>
                  </details>

                  {/* Subscriptions */}
                  <details style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Event Subscriptions</summary>
                    <div style={{ marginTop: '12px' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => kickApiCall('getSubscriptions')} disabled={!kickStatus?.connected || kickApiLoading}>GET Subscriptions</button>
                    </div>
                  </details>
                </div>
              </div>
            </section>
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