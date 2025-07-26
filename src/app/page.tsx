"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

export default function AdminPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [darkMode, setDarkMode] = useState(false);

  // Manual input states
  const [manualSubCount, setManualSubCount] = useState('');
  const [manualLatestSub, setManualLatestSub] = useState('');
  const [currentSubCount, setCurrentSubCount] = useState(0);
  const [currentLatestSub, setCurrentLatestSub] = useState('');

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await authenticatedFetch('/api/get-settings');
        if (res.ok) {
          setIsAuthenticated(true);
        } else if (res.status === 401) {
          // Not authenticated, redirect to login
          router.push('/login');
          return;
        }
      } catch (error) {
        // Network error or other issue, redirect to login
        router.push('/login');
        return;
      }
    };

    checkAuth();
  }, [router]);

  // Detect system dark mode on mount
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/get-settings');
      if (!res.ok) {
        if (res.status === 401) {
          // Not authenticated, redirect to login
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
      // fallback to defaults
      console.error('Failed to load settings:', error);
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
        // If enabling manual display, disable speed-based mode
        mergedSettings.minimapSpeedBased = false;
      }
    }
    
    if (updates.minimapSpeedBased !== undefined) {
      if (updates.minimapSpeedBased) {
        // If enabling speed-based mode, disable manual display
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

  // Switch Component
  const Switch = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => (
    <label className="switch">
      <input 
        type="checkbox" 
        checked={checked} 
        onChange={e => onChange(e.target.checked)} 
      />
      <span className="switch-slider"></span>
    </label>
  );

  // Show loading screen while checking authentication or loading settings
  if (!isAuthenticated || isLoading) return (
    <div className={`admin-root${darkMode ? ' dark' : ''}`}>
      <div className="loading-screen">
        <div className="loading-container">
          <div className="loading-logo">
            <div className="logo-icon">🎮</div>
            <div className="logo-text">Tazo Overlay</div>
          </div>
          
          <div className="loading-animation">
            <div className="loading-dots">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
          </div>
          
          <div className="loading-status">
            <div className="status-text">
              {!isAuthenticated ? 'Checking authentication...' : 'Loading settings...'}
            </div>
            <div className="status-subtitle">
              {!isAuthenticated ? 'Verifying your credentials' : 'Preparing your dashboard'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`admin-root${darkMode ? ' dark' : ''}`}>
      <div className="admin-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="admin-title">
              <span className="title-icon">🎮</span>
              <span className="title-text">Overlay Admin</span>
            </h1>
            <div className="header-subtitle">Stream overlay configuration & control</div>
          </div>
          <div className="header-right">
            <button className="preview-button" onClick={openPreview}>
              <span className="preview-icon">👁️</span>
              <span className="preview-text">Preview</span>
            </button>
                    <button className="logout-button" onClick={async () => {
          try {
            await fetch('/api/logout', {
              method: 'GET',
              credentials: 'include',
            });
            router.push('/login');
          } catch (error) {
            console.error('Logout error:', error);
            router.push('/login');
          }
        }}>
          <span className="logout-icon">🚪</span>
          <span className="logout-text">Logout</span>
        </button>
          </div>
        </div>
      </div>

      <div className={`status-bar ${saveStatus !== 'idle' ? 'active' : ''}`}>
        {saveStatus === 'saving' && (
          <div className="status-item saving">
            <div className="status-spinner"></div>
            <span>Saving changes...</span>
          </div>
        )}
        {saveStatus === 'saved' && (
          <div className="status-item saved">
            <span className="status-icon">✅</span>
            <span>Settings saved successfully!</span>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="status-item error">
            <span className="status-icon">❌</span>
            <span>Failed to save settings</span>
          </div>
        )}
      </div>

      <div className="admin-content">
        <div className="settings-grid">
          <div className="settings-section">
            <div className="section-header">
              <div className="section-icon">📍</div>
              <h2>Location & Weather</h2>
              <div className="section-description">Configure location display and weather information</div>
            </div>
            <div className="section-content">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Show Location</label>
                  <div className="setting-description">Display current city, state, or country</div>
                </div>
                <Switch 
                  checked={settings.locationDisplay !== 'hidden'} 
                  onChange={v => handleSettingsChange({ locationDisplay: v ? 'city' : 'hidden' })}
                />
              </div>
              
              {settings.locationDisplay !== 'hidden' && (
                <div className="location-format-selector">
                  <div className="format-option">
                    <input 
                      type="radio" 
                      id="location-city" 
                      name="location-format" 
                      checked={settings.locationDisplay === 'city'}
                      onChange={() => handleSettingsChange({ locationDisplay: 'city' })}
                    />
                    <label htmlFor="location-city" className="format-label">
                      <div className="format-icon">🏙️</div>
                      <div className="format-content">
                        <div className="format-title">City, Country</div>
                        <div className="format-description">Show city and country name</div>
                      </div>
                    </label>
                  </div>
                  
                  <div className="format-option">
                    <input 
                      type="radio" 
                      id="location-state" 
                      name="location-format" 
                      checked={settings.locationDisplay === 'state'}
                      onChange={() => handleSettingsChange({ locationDisplay: 'state' })}
                    />
                    <label htmlFor="location-state" className="format-label">
                      <div className="format-icon">🗺️</div>
                      <div className="format-content">
                        <div className="format-title">State, Country</div>
                        <div className="format-description">Show state/province and country</div>
                      </div>
                    </label>
                  </div>
                  
                  <div className="format-option">
                    <input 
                      type="radio" 
                      id="location-country" 
                      name="location-format" 
                      checked={settings.locationDisplay === 'country'}
                      onChange={() => handleSettingsChange({ locationDisplay: 'country' })}
                    />
                    <label htmlFor="location-country" className="format-label">
                      <div className="format-icon">🌍</div>
                      <div className="format-content">
                        <div className="format-title">Country Only</div>
                        <div className="format-description">Show only the country name</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Show Weather</label>
                  <div className="setting-description">Display current weather conditions and temperature</div>
                </div>
                <Switch 
                  checked={settings.showWeather} 
                  onChange={v => handleSettingsChange({ showWeather: v })}
                />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="section-header">
              <div className="section-icon">🗺️</div>
              <h2>Minimap</h2>
              <div className="section-description">GPS minimap display and movement tracking</div>
            </div>
            <div className="section-content">
              <div className="minimap-mode-selector">
                <div className="mode-option">
                  <input 
                    type="radio" 
                    id="minimap-off" 
                    name="minimap-mode" 
                    checked={!settings.showMinimap && !settings.minimapSpeedBased}
                    onChange={() => handleSettingsChange({ showMinimap: false, minimapSpeedBased: false })}
                  />
                  <label htmlFor="minimap-off" className="mode-label">
                    <div className="mode-icon">🚫</div>
                    <div className="mode-content">
                      <div className="mode-title">Hidden</div>
                      <div className="mode-description">Minimap is completely hidden</div>
                    </div>
                  </label>
                </div>
                
                <div className="mode-option">
                  <input 
                    type="radio" 
                    id="minimap-manual" 
                    name="minimap-mode" 
                    checked={settings.showMinimap && !settings.minimapSpeedBased}
                    onChange={() => handleSettingsChange({ showMinimap: true, minimapSpeedBased: false })}
                  />
                  <label htmlFor="minimap-manual" className="mode-label">
                    <div className="mode-icon">👁️</div>
                    <div className="mode-content">
                      <div className="mode-title">Always Show</div>
                      <div className="mode-description">Always display minimap regardless of movement</div>
                    </div>
                  </label>
                </div>
                
                <div className="mode-option">
                  <input 
                    type="radio" 
                    id="minimap-speed" 
                    name="minimap-mode" 
                    checked={settings.minimapSpeedBased && !settings.showMinimap}
                    onChange={() => handleSettingsChange({ showMinimap: false, minimapSpeedBased: true })}
                  />
                  <label htmlFor="minimap-speed" className="mode-label">
                    <div className="mode-icon">🏃</div>
                    <div className="mode-content">
                      <div className="mode-title">Auto-show on Movement</div>
                      <div className="mode-description">Show minimap only when moving above 10 km/h</div>
                    </div>
                  </label>
                </div>
              </div>
              
              {(settings.showMinimap || settings.minimapSpeedBased) && (
                <div className="minimap-status">
                  <div className="status-indicator">
                    <div className="status-dot active"></div>
                    <span className="status-text">
                      {settings.minimapSpeedBased ? 'Minimap will show when moving' : 'Minimap will be visible on overlay'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="settings-section">
            <div className="section-header">
              <div className="section-icon">🎯</div>
              <h2>Kick.com Integration</h2>
              <div className="section-description">Subscription goals and community features</div>
            </div>
            <div className="section-content">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Enable Kick Overlay</label>
                  <div className="setting-description">Show or hide the entire Kick.com section on the overlay</div>
                </div>
                <Switch 
                  checked={settings.showKickSubGoal || settings.showLatestSub || settings.showSubLeaderboard} 
                  onChange={v => {
                    if (v) {
                      handleSettingsChange({ showKickSubGoal: true });
                    } else {
                      handleSettingsChange({ 
                        showKickSubGoal: false, 
                        showLatestSub: false, 
                        showSubLeaderboard: false 
                      });
                    }
                  }}
                />
              </div>


              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Daily Sub Goal</label>
                  <div className="setting-description">Target number of subscriptions for today</div>
                </div>
                <input 
                  type="number" 
                  value={settings.kickDailySubGoal?.toString() || ''} 
                  onChange={e => handleSettingsChange({ kickDailySubGoal: parseInt(e.target.value) || 0 })}
                  className="number-input"
                  min="0"
                />
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Show Sub Goal</label>
                  <div className="setting-description">Display subscription goal progress</div>
                </div>
                <Switch 
                  checked={settings.showKickSubGoal} 
                  onChange={v => handleSettingsChange({ showKickSubGoal: v })}
                />
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Show Latest Sub</label>
                  <div className="setting-description">Display the most recent subscriber</div>
                </div>
                <Switch 
                  checked={settings.showLatestSub} 
                  onChange={v => handleSettingsChange({ showLatestSub: v })}
                />
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Show Leaderboard</label>
                  <div className="setting-description">Display top 5 gift subscribers</div>
                </div>
                <Switch 
                  checked={settings.showSubLeaderboard} 
                  onChange={v => handleSettingsChange({ showSubLeaderboard: v })}
                />
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Enable Rolling Goal</label>
                  <div className="setting-description">Automatically increase goal when reached</div>
                </div>
                <Switch 
                  checked={settings.enableRollingSubGoal} 
                  onChange={v => handleSettingsChange({ enableRollingSubGoal: v })}
                />
              </div>

              {settings.enableRollingSubGoal && (
                <div className="setting-item sub-setting">
                  <div className="setting-info">
                    <label className="setting-label">Goal Increment</label>
                    <div className="setting-description">How much to increase the goal by</div>
                  </div>
                  <input 
                    type="number" 
                    value={settings.rollingSubGoalIncrement?.toString() || ''} 
                    onChange={e => handleSettingsChange({ rollingSubGoalIncrement: parseInt(e.target.value) || 1 })}
                    className="number-input"
                    min="1"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="settings-section">
            <div className="section-header">
              <div className="section-icon">✏️</div>
              <h2>Manual Updates</h2>
              <div className="section-description">Manually update subscription data</div>
            </div>
            <div className="section-content">
              <div className="current-stats">
                <div className="stat-card">
                  <div className="stat-label">Current Sub Count</div>
                  <div className="stat-value">{currentSubCount}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Latest Sub</div>
                  <div className="stat-value">{currentLatestSub || 'None'}</div>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Update Sub Count</label>
                  <div className="setting-description">Manually set the current subscription count</div>
                </div>
                <div className="input-group">
                  <input 
                    type="number" 
                    value={manualSubCount} 
                    onChange={e => setManualSubCount(e.target.value)}
                    className="text-input"
                    placeholder="Enter new count"
                    min="0"
                  />
                  <button 
                    className="action-button"
                    onClick={handleManualSubCountUpdate}
                    disabled={!manualSubCount.trim()}
                  >
                    Update
                  </button>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Update Latest Sub</label>
                  <div className="setting-description">Manually set the latest subscriber name</div>
                </div>
                <div className="input-group">
                  <input 
                    type="text" 
                    value={manualLatestSub} 
                    onChange={e => setManualLatestSub(e.target.value)}
                    className="text-input"
                    placeholder="Enter username"
                  />
                  <button 
                    className="action-button"
                    onClick={handleManualLatestSubUpdate}
                    disabled={!manualLatestSub.trim()}
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        :root {
          --bg-primary: #ffffff;
          --bg-secondary: #f8fafc;
          --bg-tertiary: #f1f5f9;
          --bg-card: #ffffff;
          --text-primary: #1e293b;
          --text-secondary: #64748b;
          --text-muted: #94a3b8;
          --border-light: #e2e8f0;
          --border-medium: #cbd5e1;
          --accent-primary: #3b82f6;
          --accent-secondary: #1d4ed8;
          --accent-success: #10b981;
          --accent-warning: #f59e0b;
          --accent-error: #ef4444;
          --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
          --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
          --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
          --radius-sm: 0.375rem;
          --radius-md: 0.5rem;
          --radius-lg: 0.75rem;
          --radius-xl: 1rem;
        }

        .dark {
          --bg-primary: #0f172a;
          --bg-secondary: #1e293b;
          --bg-tertiary: #334155;
          --bg-card: #1e293b;
          --text-primary: #f8fafc;
          --text-secondary: #cbd5e1;
          --text-muted: #94a3b8;
          --border-light: #334155;
          --border-medium: #475569;
          --accent-primary: #60a5fa;
          --accent-secondary: #3b82f6;
          --accent-success: #34d399;
          --accent-warning: #fbbf24;
          --accent-error: #f87171;
        }

        .admin-root {
          background: var(--bg-primary);
          color: var(--text-primary);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .loading-screen {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2rem;
          padding: 3rem;
          background: white;
          border-radius: 1rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          border: 1px solid #e2e8f0;
          max-width: 400px;
          width: 90%;
          text-align: center;
        }

        .loading-logo {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }

        .logo-icon {
          font-size: 4rem;
          animation: pulse 2s ease-in-out infinite;
        }

        .logo-text {
          font-size: 1.5rem;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea, #764ba2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .loading-animation {
          display: flex;
          justify-content: center;
        }

        .loading-dots {
          display: flex;
          gap: 0.5rem;
        }

        .dot {
          width: 0.75rem;
          height: 0.75rem;
          background: #667eea;
          border-radius: 50%;
          animation: dotBounce 1.4s ease-in-out infinite both;
        }

        .dot:nth-child(1) { animation-delay: -0.32s; }
        .dot:nth-child(2) { animation-delay: -0.16s; }
        .dot:nth-child(3) { animation-delay: 0s; }

        .loading-status {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .status-text {
          font-size: 1.125rem;
          font-weight: 600;
          color: #1a202c;
        }

        .status-subtitle {
          font-size: 0.875rem;
          color: #718096;
          opacity: 0.8;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }

        @keyframes dotBounce {
          0%, 80%, 100% { 
            transform: scale(0);
            opacity: 0.5;
          }
          40% { 
            transform: scale(1);
            opacity: 1;
          }
        }

        .admin-header {
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-light);
          box-shadow: var(--shadow-sm);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1.5rem 2rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .header-left {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .admin-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 0;
          font-size: 1.875rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .title-icon {
          font-size: 2rem;
        }

        .title-text {
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header-subtitle {
          color: var(--text-secondary);
          font-size: 0.875rem;
          font-weight: 500;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .preview-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          background: var(--accent-primary);
          color: white;
          border: none;
          border-radius: var(--radius-lg);
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--shadow-md);
        }

        .preview-button:hover {
          background: var(--accent-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-lg);
        }

        .preview-icon {
          font-size: 1rem;
        }

        .logout-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .logout-button:hover {
          background: var(--bg-tertiary);
          border-color: var(--border-dark);
          transform: translateY(-1px);
        }

        .logout-icon {
          font-size: 1rem;
        }

        .status-bar {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-light);
          padding: 0.75rem 2rem;
          opacity: 0;
          transform: translateY(-100%);
          transition: all 0.3s ease;
        }

        .status-bar.active {
          opacity: 1;
          transform: translateY(0);
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-item.saving {
          color: var(--accent-warning);
        }

        .status-item.saved {
          color: var(--accent-success);
        }

        .status-item.error {
          color: var(--accent-error);
        }

        .status-spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid var(--border-light);
          border-top: 2px solid var(--accent-warning);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .status-icon {
          font-size: 1rem;
        }

        .admin-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 2rem;
        }

        .settings-section {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          overflow: hidden;
          box-shadow: var(--shadow-md);
          transition: all 0.2s ease;
        }

        .settings-section:hover {
          box-shadow: var(--shadow-lg);
          transform: translateY(-2px);
        }

        .section-header {
          background: var(--bg-secondary);
          padding: 1.5rem;
          border-bottom: 1px solid var(--border-light);
        }

        .section-header h2 {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 0 0 0.5rem 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .section-icon {
          font-size: 1.5rem;
        }

        .section-description {
          color: var(--text-secondary);
          font-size: 0.875rem;
          margin-left: 2.25rem;
        }

        .section-content {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .setting-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          padding: 1.25rem;
          background: var(--bg-tertiary);
          border-radius: var(--radius-lg);
          transition: all 0.2s ease;
          margin-bottom: 1rem;
          border: 1px solid var(--border-light);
        }

        .setting-item:hover {
          background: var(--bg-secondary);
          border-color: var(--border-medium);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .setting-item.sub-setting {
          margin-left: 2rem;
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
        }

        .setting-info {
          flex: 1;
          min-width: 0;
        }

        .setting-label {
          display: block;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 0.25rem;
        }

        .setting-description {
          color: var(--text-secondary);
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 3.5rem;
          height: 2rem;
          flex-shrink: 0;
        }

        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .switch-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--border-medium);
          transition: 0.3s;
          border-radius: 2rem;
        }

        .switch-slider:before {
          position: absolute;
          content: "";
          height: 1.5rem;
          width: 1.5rem;
          left: 0.25rem;
          bottom: 0.25rem;
          background: white;
          transition: 0.3s;
          border-radius: 50%;
          box-shadow: var(--shadow-sm);
        }

        input:checked + .switch-slider {
          background: var(--accent-primary);
        }

        input:checked + .switch-slider:before {
          transform: translateX(1.5rem);
        }

        .radio-group {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          width: 100%;
        }

        .radio-option {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: var(--radius-md);
          transition: all 0.2s ease;
          position: relative;
          z-index: 2;
        }

        .radio-option:hover {
          background: var(--bg-secondary);
        }

        .radio-option input {
          display: none;
        }

        .radio-custom {
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid var(--border-medium);
          border-radius: 50%;
          position: relative;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .radio-option input:checked + .radio-custom {
          border-color: var(--accent-primary);
          background: var(--accent-primary);
        }

        .radio-option input:checked + .radio-custom:after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 0.5rem;
          height: 0.5rem;
          background: white;
          border-radius: 50%;
        }

        .radio-label {
          font-weight: 500;
          color: var(--text-primary);
          z-index: 3;
          position: relative;
        }



        .number-input,
        .text-input {
          padding: 0.75rem;
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s ease;
          min-width: 120px;
        }

        .number-input:focus,
        .text-input:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          transform: translateY(-1px);
        }

        .input-group {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }

        .action-button {
          padding: 0.75rem 1rem;
          background: var(--accent-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          box-shadow: var(--shadow-sm);
        }

        .action-button:hover:not(:disabled) {
          background: var(--accent-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .action-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .current-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .stat-card {
          padding: 1.25rem;
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          text-align: center;
          transition: all 0.2s ease;
        }

        .stat-card:hover {
          border-color: var(--border-medium);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .stat-label {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .stat-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--accent-primary);
        }

        /* === MINIMAP MODE SELECTOR === */
        .minimap-mode-selector {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .mode-option {
          position: relative;
        }

        .mode-option input[type="radio"] {
          display: none;
        }

        .mode-label {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 2px solid var(--border-light);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .mode-label:hover {
          background: var(--bg-secondary);
          border-color: var(--border-medium);
        }

        .mode-option input[type="radio"]:checked + .mode-label {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: white;
        }

        .mode-option input[type="radio"]:checked + .mode-label .mode-description {
          color: rgba(255, 255, 255, 0.8);
        }

        .mode-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .mode-content {
          flex: 1;
        }

        .mode-title {
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .mode-description {
          font-size: 0.875rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .minimap-status {
          padding: 1rem;
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          margin-top: 0.5rem;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .status-dot {
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 50%;
          background: var(--accent-success);
          animation: pulse 2s infinite;
        }

        .status-dot.active {
          background: var(--accent-success);
        }

        .status-text {
          font-weight: 500;
          color: var(--text-primary);
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }



        /* === LOCATION FORMAT SELECTOR === */
        .location-format-selector {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .format-option {
          position: relative;
        }

        .format-option input[type="radio"] {
          display: none;
        }

        .format-label {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 2px solid var(--border-light);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .format-label:hover {
          background: var(--bg-secondary);
          border-color: var(--border-medium);
        }

        .format-option input[type="radio"]:checked + .format-label {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: white;
        }

        .format-option input[type="radio"]:checked + .format-label .format-description {
          color: rgba(255, 255, 255, 0.8);
        }

        .format-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .format-content {
          flex: 1;
        }

        .format-title {
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .format-description {
          font-size: 0.875rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        @media (max-width: 768px) {
          .header-content {
            padding: 1rem;
            flex-direction: column;
            gap: 1rem;
            text-align: center;
          }

          .admin-title {
            font-size: 1.5rem;
          }

          .header-right {
            width: 100%;
            justify-content: center;
          }

          .admin-content {
            padding: 1rem;
          }

          .settings-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .setting-item {
            flex-direction: column;
            align-items: stretch;
            gap: 1rem;
          }

          .input-group {
            flex-direction: column;
          }

          .current-stats {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .loading-container {
            padding: 2rem;
            gap: 1.5rem;
          }

          .logo-icon {
            font-size: 3rem;
          }

          .logo-text {
            font-size: 1.25rem;
          }

          .status-text {
            font-size: 1rem;
          }

          .admin-title {
            font-size: 1.25rem;
          }

          .preview-button .preview-text {
            display: none;
          }

          .section-header {
            padding: 1rem;
          }

          .section-content {
            padding: 1rem;
          }
        }
      `}</style>
    </div>
  );
} 