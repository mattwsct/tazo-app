"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, MapZoomLevel, DisplayMode, TodoItem } from '@/types/settings';
import { DEFAULT_KICK_MESSAGES, KICK_MESSAGE_KEYS } from '@/types/kick-messages';
import type { KickMessageTemplates } from '@/types/kick-messages';
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
  const [kickMessages, setKickMessages] = useState<KickMessageTemplates>(DEFAULT_KICK_MESSAGES);
  const [kickTestMessage, setKickTestMessage] = useState('');
  const [kickTestSending, setKickTestSending] = useState(false);
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
      .then(setKickMessages)
      .catch(() => {});
  }, [isAuthenticated]);

  const handleKickMessageChange = useCallback((key: keyof KickMessageTemplates, value: string) => {
    setKickMessages((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveKickMessages = useCallback(async () => {
    setToast({ type: 'saving', message: 'Saving messages...' });
    try {
      const r = await authenticatedFetch('/api/kick-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kickMessages),
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
  }, [kickMessages]);

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
                      <a href="/api/kick-oauth/authorize" className="btn btn-secondary btn-small">
                        🔄 Reconnect
                      </a>
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
                    <a href="/api/kick-oauth/authorize" className="btn btn-primary" style={{ marginTop: '8px' }}>
                      Connect Kick
                    </a>
                  </div>
                )}
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
                <p className="group-label" style={{ marginBottom: '12px', fontWeight: 400, opacity: 0.9, fontSize: '0.9rem' }}>
                  Use placeholders like {'{name}'}, {'{gifter}'}, {'{months}'}, {'{count}'}, {'{sender}'}, {'{amount}'}, {'{redeemer}'}, {'{title}'}, {'{userInput}'}, {'{message}'}.
                </p>
                <div className="kick-messages-grid">
                  {KICK_MESSAGE_KEYS.map((key) => (
                    <div key={key} className="kick-message-field">
                      <label className="kick-message-label">{KICK_MESSAGE_LABELS[key]}</label>
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