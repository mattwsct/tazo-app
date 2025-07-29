"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import '@/styles/admin.css';

export default function AdminPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Manual input states
  const [manualSubCount, setManualSubCount] = useState('');
  const [manualLatestSub, setManualLatestSub] = useState('');
  const [currentSubCount, setCurrentSubCount] = useState(0);
  const [currentLatestSub, setCurrentLatestSub] = useState('');

  // Check authentication status
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

  const loadSettings = useCallback(async () => {
    try {
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
        if (data._subGoalData) {
          setCurrentSubCount(data._subGoalData.currentSubs || 0);
          setCurrentLatestSub(data._subGoalData.latestSub || '');
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Settings load timed out');
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

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
    
    // Handle location display logic
    if (updates.locationDisplay === 'hidden') {
      mergedSettings.showMinimap = false;
      mergedSettings.minimapSpeedBased = false;
    }
    
    setSettings(mergedSettings);
    setSaveStatus('saving');
    try {
      const res = await authenticatedFetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedSettings),
      });
      if (!res.ok) throw new Error();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [settings]);

  const handleManualSubCountUpdate = useCallback(async () => {
    const count = parseInt(manualSubCount);
    if (isNaN(count) || count < 0) return;
    try {
      const res = await authenticatedFetch('/api/update-sub-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSubs: count }),
      });
      if (res.ok) {
        setCurrentSubCount(count);
        setManualSubCount('');
        loadSettings();
      }
    } catch {}
  }, [manualSubCount, loadSettings]);

  const handleManualLatestSubUpdate = useCallback(async () => {
    if (!manualLatestSub.trim()) return;
    try {
      const res = await authenticatedFetch('/api/update-sub-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latestSub: manualLatestSub.trim() }),
      });
      if (res.ok) {
        setCurrentLatestSub(manualLatestSub.trim());
        setManualLatestSub('');
        loadSettings();
      }
    } catch {}
  }, [manualLatestSub, loadSettings]);

  const openPreview = () => {
    window.open('/overlay', '_blank');
  };

  // Simple Toggle Component
  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) => (
    <div className="toggle-item">
      <span className="toggle-label">{label}</span>
      <button 
        className={`toggle ${checked ? 'active' : ''}`}
        onClick={() => onChange(!checked)}
        aria-label={label}
      >
        <div className="toggle-slider"></div>
      </button>
    </div>
  );

  // Simple Radio Group Component
  const RadioGroup = ({ 
    options, 
    value, 
    onChange
  }: { 
    options: { value: string; label: string; icon: string }[]; 
    value: string; 
    onChange: (value: string) => void; 
  }) => (
    <div className="radio-group">
      {options.map((option) => (
        <button
          key={option.value}
          className={`radio-option ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          <span className="radio-icon">{option.icon}</span>
          <span className="radio-label">{option.label}</span>
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

      {/* Status Bar */}
      {saveStatus !== 'idle' && (
        <div className={`status-bar ${saveStatus}`}>
          {saveStatus === 'saving' && 'Saving changes...'}
          {saveStatus === 'saved' && '✅ Settings saved!'}
          {saveStatus === 'error' && '❌ Failed to save settings'}
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        <div className="settings-container">
          
          {/* Location & Weather Section */}
          <section className="settings-section">
            <h2>📍 Location & Weather</h2>
            
            <Toggle
              checked={settings.locationDisplay !== 'hidden'}
              onChange={(checked) => handleSettingsChange({ locationDisplay: checked ? 'city' : 'hidden' })}
              label="Show Location"
            />
            
            {settings.locationDisplay !== 'hidden' && (
              <div className="setting-group">
                <label className="group-label">Location Format</label>
                <RadioGroup
                  value={settings.locationDisplay}
                  onChange={(value) => handleSettingsChange({ locationDisplay: value as 'city' | 'state' })}
                  options={[
                    { value: 'city', label: 'City, Country', icon: '🏙️' },
                    { value: 'state', label: 'State, Country', icon: '🗺️' }
                  ]}
                />
              </div>
            )}
            
            <Toggle
              checked={settings.showWeather}
              onChange={(checked) => handleSettingsChange({ showWeather: checked })}
              label="Show Weather"
            />
          </section>

          {/* Minimap Section */}
          <section className="settings-section">
            <h2>🗺️ Minimap</h2>
            
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
                  { value: 'hidden', label: 'Hidden', icon: '🚫' },
                  { value: 'always', label: 'Always Show', icon: '👁️' },
                  { value: 'speed', label: 'Auto-show on Movement', icon: '🏃' }
                ]}
              />
            </div>
          </section>

          {/* Kick Integration Section */}
          <section className="settings-section">
            <h2>🎯 Kick.com Integration</h2>
            
            <Toggle
              checked={settings.showKickSubGoal || settings.showLatestSub || settings.showSubLeaderboard}
              onChange={(checked) => {
                if (checked) {
                  handleSettingsChange({ showKickSubGoal: true });
                } else {
                  handleSettingsChange({ 
                    showKickSubGoal: false, 
                    showLatestSub: false, 
                    showSubLeaderboard: false 
                  });
                }
              }}
              label="Enable Kick Overlay"
            />
            
            <div className="setting-group">
              <label className="setting-label">Daily Sub Goal</label>
              <input
                type="number"
                value={settings.kickDailySubGoal?.toString() || ''}
                onChange={(e) => handleSettingsChange({ kickDailySubGoal: parseInt(e.target.value) || 0 })}
                className="input"
                min="0"
                placeholder="Enter goal"
              />
            </div>
            
            <Toggle
              checked={settings.showKickSubGoal}
              onChange={(checked) => handleSettingsChange({ showKickSubGoal: checked })}
              label="Show Sub Goal"
            />
            
            <Toggle
              checked={settings.showLatestSub}
              onChange={(checked) => handleSettingsChange({ showLatestSub: checked })}
              label="Show Latest Sub"
            />
            
            <Toggle
              checked={settings.showSubLeaderboard}
              onChange={(checked) => handleSettingsChange({ showSubLeaderboard: checked })}
              label="Show Leaderboard"
            />
            
            <Toggle
              checked={settings.enableRollingSubGoal}
              onChange={(checked) => handleSettingsChange({ enableRollingSubGoal: checked })}
              label="Enable Rolling Goal"
            />
            
            {settings.enableRollingSubGoal && (
              <div className="setting-group">
                <label className="setting-label">Goal Increment</label>
                <input
                  type="number"
                  value={settings.rollingSubGoalIncrement?.toString() || ''}
                  onChange={(e) => handleSettingsChange({ rollingSubGoalIncrement: parseInt(e.target.value) || 1 })}
                  className="input"
                  min="1"
                  placeholder="Enter increment"
                />
              </div>
            )}
          </section>

          {/* Manual Updates Section */}
          <section className="settings-section">
            <h2>✏️ Manual Updates</h2>
            
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Current Sub Count</div>
                <div className="stat-value">{currentSubCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Latest Sub</div>
                <div className="stat-value">{currentLatestSub || 'None'}</div>
              </div>
            </div>
            
            <div className="setting-group">
              <label className="setting-label">Update Sub Count</label>
              <div className="input-group">
                <input
                  type="number"
                  value={manualSubCount}
                  onChange={(e) => setManualSubCount(e.target.value)}
                  className="input"
                  placeholder="Enter new count"
                  min="0"
                />
                <button 
                  className="btn btn-primary"
                  onClick={handleManualSubCountUpdate}
                  disabled={!manualSubCount.trim()}
                >
                  Update
                </button>
              </div>
            </div>
            
            <div className="setting-group">
              <label className="setting-label">Update Latest Sub</label>
              <div className="input-group">
                <input
                  type="text"
                  value={manualLatestSub}
                  onChange={(e) => setManualLatestSub(e.target.value)}
                  className="input"
                  placeholder="Enter username"
                />
                <button 
                  className="btn btn-primary"
                  onClick={handleManualLatestSubUpdate}
                  disabled={!manualLatestSub.trim()}
                >
                  Update
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
} 