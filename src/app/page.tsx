"use client";

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import '@/styles/admin.css';

type TabType = 'display' | 'kick';

export default function AdminPage() {
  // Performance monitoring
  useRenderPerformance('AdminPage');
  
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabType>('display');

  // Ensure settings always have all required properties
  const safeSettings = { ...DEFAULT_OVERLAY_SETTINGS, ...settings };
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Manual override state
  const [manualSubCount, setManualSubCount] = useState('');
  const [manualLatestSub, setManualLatestSub] = useState('');
  
  // Current values state
  const [currentSubCount, setCurrentSubCount] = useState<number>(0);
  const [currentLatestSub, setCurrentLatestSub] = useState<string>('');
  



  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    const duration = message.includes('✓') ? 1500 : 3000;
    setTimeout(() => setShowToast(false), duration);
  };

  // Check for existing session
  useEffect(() => {
    const savedAuth = localStorage.getItem('admin_authenticated');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Load settings when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setIsLoading(true);
      authenticatedFetch('/api/get-settings')
        .then(res => {
          if (!res.ok) {
            if (res.status === 401) {
              console.log('Not authenticated, using default settings');
              setSettings(DEFAULT_OVERLAY_SETTINGS);
              return null;
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then(data => {
          if (data) {
            const mergedSettings = { ...DEFAULT_OVERLAY_SETTINGS, ...data };
            setSettings(mergedSettings);
            
            // Extract current sub goal data if present
            if (data._subGoalData) {
              if (data._subGoalData.currentSubs !== undefined) {
                setCurrentSubCount(data._subGoalData.currentSubs);
              }
              
              if (data._subGoalData.latestSub !== undefined) {
                setCurrentLatestSub(data._subGoalData.latestSub || '');
              }
            } else {
              console.log('Admin: No sub goal data found in settings');
              console.log('Admin: Available data keys:', Object.keys(data));
            }
            
            // Ensure settings are saved to KV storage for overlay access
            // This helps when both pages refresh at the same time
            authenticatedFetch('/api/save-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(mergedSettings),
            }).then(result => {
              if (result.ok) {
                console.log('Admin: Ensured settings are saved to KV storage');
              }
            }).catch(error => {
              console.warn('Admin: Failed to ensure settings are saved:', error);
            });
            
            // Also ensure Kick overlay settings are properly set if they're missing
            if (!mergedSettings.showKickSubGoal) {
              console.log('Admin: Kick overlay is disabled, enabling it...');
              const kickEnabledSettings = {
                ...mergedSettings,
                showKickSubGoal: true,
                showLatestSub: true,
                showSubLeaderboard: true,
                kickDailySubGoal: 100
              };
              
              authenticatedFetch('/api/save-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(kickEnabledSettings),
              }).then(result => {
                if (result.ok) {
                  console.log('Admin: Enabled Kick overlay settings');
                  setSettings(kickEnabledSettings);
                }
              }).catch(error => {
                console.warn('Admin: Failed to enable Kick overlay settings:', error);
              });
            }
          }
        })
        .catch((error) => {
          console.error('Failed to load settings:', error);
          showToastMessage('Failed to load settings. Using defaults.');
          setSettings(DEFAULT_OVERLAY_SETTINGS);
        })
        .finally(() => setIsLoading(false));
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    if (!password.trim()) {
      showToastMessage('Please enter a password');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (response.ok) {
        setIsAuthenticated(true);
        localStorage.setItem('admin_authenticated', 'true');
        setPassword('');
        showToastMessage('Successfully logged in!');
      } else {
        showToastMessage('Incorrect password. Please try again.');
      }
    } catch {
      showToastMessage('Login failed. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    fetch('/api/admin-logout', { method: 'POST' });
    setIsAuthenticated(false);
    localStorage.removeItem('admin_authenticated');
    showToastMessage('Logged out successfully');
  };

  const handleManualSubCountUpdate = async () => {
    if (!manualSubCount.trim()) {
      showToastMessage('Please enter a sub count');
      return;
    }

    const count = parseInt(manualSubCount);
    if (isNaN(count) || count < 0) {
      showToastMessage('Please enter a valid number');
      return;
    }

    try {
      const response = await authenticatedFetch('/api/manual-sub-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_count',
          count: count,
          channel: 'Tazo'
        }),
      });

      if (response.ok) {
        setManualSubCount('');
        setCurrentSubCount(count); // Update current value
        // Removed duplicate toast message - settings change handler will show "Saved"
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to update sub count:', error);
      showToastMessage('Failed to update sub count');
    }
  };

  const handleManualLatestSubUpdate = async () => {
    if (!manualLatestSub.trim()) {
      showToastMessage('Please enter a username');
      return;
    }

    try {
      const response = await authenticatedFetch('/api/manual-sub-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_latest_sub',
          username: manualLatestSub.trim(),
          channel: 'Tazo'
        }),
      });

      if (response.ok) {
        setManualLatestSub('');
        setCurrentLatestSub(manualLatestSub.trim()); // Update current value
        // Removed duplicate toast message - settings change handler will show "Saved"
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to update latest subscriber:', error);
      showToastMessage('Failed to update latest subscriber');
    }
  };

  const handleResetSubGoal = async () => {
    try {
      const response = await authenticatedFetch('/api/manual-sub-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_goal',
          channel: 'Tazo'
        }),
      });

      if (response.ok) {
        setCurrentSubCount(0); // Reset current value
        setCurrentLatestSub(''); // Reset current value
        // Removed duplicate toast message - settings change handler will show "Saved"
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to reset sub goal:', error);
      showToastMessage('Failed to reset sub goal');
    }
  };


  const handleSettingsChange = async (newSettings: Partial<OverlaySettings>) => {
    // Check if minimap should be disabled based on location settings
    const finalSettings = {
      ...newSettings,
      ...(newSettings.locationDisplay && 
          newSettings.locationDisplay === 'hidden'
        ? { showMinimap: false, minimapSpeedBased: false }
        : {}
      ),
      // Set default to "Off" when switching to state or country, but only if minimap is currently enabled
      ...(newSettings.locationDisplay && 
          (newSettings.locationDisplay === 'state' || newSettings.locationDisplay === 'country') &&
          settings.showMinimap
        ? { showMinimap: false, minimapSpeedBased: false }
        : {}
      ),
      // Set default to "When Moving" when switching to city
      ...(newSettings.locationDisplay && 
          newSettings.locationDisplay === 'city' &&
          !settings.showMinimap
        ? { showMinimap: true, minimapSpeedBased: true }
        : {}
      )
    };
    
    const updatedSettings = { ...settings, ...finalSettings };
    setSettings(updatedSettings);
    
    try {
      const result = await authenticatedFetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      });
      
      if (result.ok) {
        console.log('Admin: Settings save result:', result);
        showToastMessage('Saved');
      } else {
        throw new Error(`HTTP ${result.status}`);
      }
    } catch (error) {
      console.warn('Auto-save warning (settings may still be saved):', error);
    }
  };

  // === 🎨 RENDER LOGIN FORM ===
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <div className="admin-container">
          <div className="admin-content">
            <div className="admin-login">
              <h1>🎮 Stream Control Panel</h1>
              <p>Configure your live streaming overlay</p>
              
              <div className="form-group">
                <label htmlFor="password">Admin Password:</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleLogin()}
                  placeholder="Enter password"
                  disabled={isLoading}
                  className={isLoading ? 'loading' : ''}
                />
              </div>
              
              <button 
                onClick={handleLogin} 
                disabled={isLoading}
                className={`primary ${isLoading ? 'loading' : ''}`}
              >
                {isLoading ? '🔄 Logging in...' : '🔐 Access Panel'}
              </button>
            </div>
          </div>

          {showToast && (
            <div className={`toast ${toastMessage.includes('Failed') ? 'error' : 'success'}`}>
              {toastMessage}
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  // === 🎨 RENDER ADMIN PANEL ===
  return (
    <ErrorBoundary>
      <div className="admin-container">
        <div className="admin-content">
          {/* Header */}
          <div className="admin-header">
            <div className="header-main">
              <h1>🎮 Stream Control</h1>
              <p>Configure your live streaming overlay</p>
            </div>
            <div className="header-actions">
              <a 
                href="/overlay" 
                target="_blank" 
                rel="noopener noreferrer"
                className="preview-btn"
              >
                <span className="btn-icon">🖥️</span>
                <span className="btn-text">Preview</span>
              </a>
              <button onClick={handleLogout} className="logout-btn">
                <span className="btn-icon">🚪</span>
                <span className="btn-text">Logout</span>
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner"></div>
              <span>Loading settings...</span>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button 
              className={`tab-button ${activeTab === 'display' ? 'active' : ''}`}
              onClick={() => setActiveTab('display')}
            >
              <span className="tab-icon">📺</span>
              <span className="tab-text">Display & Location</span>
            </button>
            <button 
              className={`tab-button ${activeTab === 'kick' ? 'active' : ''}`}
              onClick={() => setActiveTab('kick')}
            >
              <span className="tab-icon">🎯</span>
              <span className="tab-text">Kick.com</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'display' && (
              <div className="tab-panel">
                <div className="panel-header">
                  <h2>Display Settings</h2>
                  <p>Configure what information appears on your overlay</p>
                </div>
                <div className="settings-list">
                  {/* Weather Display */}
                  <div className="setting-item">
                    <div className="setting-info">
                      <div className="setting-icon">🌤️</div>
                      <div className="setting-details">
                        <h3>Weather Display</h3>
                        <p>Show current weather conditions and temperature</p>
                      </div>
                    </div>
                    <div className="setting-control">
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={safeSettings.showWeather}
                          onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  {/* Location Display */}
                  <div className="setting-item">
                    <div className="setting-info">
                      <div className="setting-icon">🏙️</div>
                      <div className="setting-details">
                        <h3>Location Display</h3>
                        <p>Choose how your current location is shown</p>
                      </div>
                    </div>
                    <div className="setting-control">
                      <div className="location-options">
                        <label className={`location-option ${safeSettings.locationDisplay === 'city' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="locationDisplay"
                            value="city"
                            checked={safeSettings.locationDisplay === 'city'}
                            onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                          />
                          <span className="option-icon">🏙️</span>
                          <span className="option-text">City</span>
                        </label>
                        
                        <label className={`location-option ${safeSettings.locationDisplay === 'state' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="locationDisplay"
                            value="state"
                            checked={safeSettings.locationDisplay === 'state'}
                            onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                          />
                          <span className="option-icon">🗺️</span>
                          <span className="option-text">State</span>
                        </label>
                        
                        <label className={`location-option ${safeSettings.locationDisplay === 'country' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="locationDisplay"
                            value="country"
                            checked={safeSettings.locationDisplay === 'country'}
                            onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                          />
                          <span className="option-icon">🌍</span>
                          <span className="option-text">Country</span>
                        </label>
                        
                        <label className={`location-option ${safeSettings.locationDisplay === 'hidden' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="locationDisplay"
                            value="hidden"
                            checked={safeSettings.locationDisplay === 'hidden'}
                            onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                          />
                          <span className="option-icon">🚫</span>
                          <span className="option-text">Hidden</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* GPS Minimap Display Options */}
                  <div className={`setting-item ${safeSettings.locationDisplay === 'hidden' ? 'disabled' : ''}`}>
                    <div className="setting-info">
                      <div className="setting-icon">🗺️</div>
                      <div className="setting-details">
                        <h3>GPS Minimap</h3>
                        <p>
                          {safeSettings.locationDisplay === 'hidden' 
                            ? 'Disabled - Location display is hidden'
                            : 'Choose when to show the circular minimap with your location'
                          }
                        </p>
                      </div>
                    </div>
                    <div className="setting-control">
                      <div className={`location-options ${safeSettings.locationDisplay === 'hidden' ? 'disabled' : ''}`}>
                        <label className={`location-option ${safeSettings.showMinimap && !safeSettings.minimapSpeedBased ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="minimapDisplay"
                            value="always"
                            checked={safeSettings.showMinimap && !safeSettings.minimapSpeedBased}
                            onChange={() => handleSettingsChange({ showMinimap: true, minimapSpeedBased: false })}
                            disabled={safeSettings.locationDisplay === 'hidden'}
                          />
                          <span className="option-icon">👁️</span>
                          <span className="option-text">Always On</span>
                        </label>
                        
                        <label className={`location-option ${safeSettings.showMinimap && safeSettings.minimapSpeedBased ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="minimapDisplay"
                            value="moving"
                            checked={safeSettings.showMinimap && safeSettings.minimapSpeedBased}
                            onChange={() => handleSettingsChange({ showMinimap: true, minimapSpeedBased: true })}
                            disabled={safeSettings.locationDisplay === 'hidden'}
                          />
                          <span className="option-icon">🚗</span>
                          <span className="option-text">When Moving</span>
                        </label>
                        
                        <label className={`location-option ${!safeSettings.showMinimap ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="minimapDisplay"
                            value="off"
                            checked={!safeSettings.showMinimap}
                            onChange={() => handleSettingsChange({ showMinimap: false })}
                            disabled={safeSettings.locationDisplay === 'hidden'}
                          />
                          <span className="option-icon">🚫</span>
                          <span className="option-text">Off</span>
                        </label>
                      </div>
                    </div>
                  </div>


                </div>
              </div>
            )}



            {activeTab === 'kick' && (
              <div className="tab-panel">
                <div className="panel-header">
                  <h2>Kick.com Settings</h2>
                  <p>Configure subscription goals and community features</p>
                </div>
                <div className="settings-list">
                  {/* Kick.com Sub Goal - Main Toggle */}
                  <div className="setting-item">
                    <div className="setting-info">
                      <div className="setting-icon">🎯</div>
                      <div className="setting-details">
                        <h3>Kick.com Integration</h3>
                        <p>Enable subscription goal tracking and community features</p>
                      </div>
                    </div>
                    <div className="setting-control">
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={safeSettings.showKickSubGoal}
                          onChange={(e) => handleSettingsChange({ showKickSubGoal: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  {/* Channel Configuration */}
                  {safeSettings.showKickSubGoal && (
                    <div className="settings-group">
                      <div className="group-header">
                        <h3>Channel Configuration</h3>
                      </div>
                      
                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">🎯</div>
                          <div className="setting-details">
                            <h3>Daily Sub Goal</h3>
                            <p>Target number of subscriptions per day</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={safeSettings.kickDailySubGoal}
                            onChange={(e) => handleSettingsChange({ kickDailySubGoal: parseInt(e.target.value) || 10 })}
                            onBlur={(e) => {
                              const value = parseInt(e.target.value);
                              if (isNaN(value) || value < 1) {
                                handleSettingsChange({ kickDailySubGoal: 10 });
                              }
                            }}
                            className="number-input"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Display Options */}
                  {safeSettings.showKickSubGoal && (
                    <div className="settings-group">
                      <div className="group-header">
                        <h3>Display Options</h3>
                      </div>
                      
                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">👤</div>
                          <div className="setting-details">
                            <h3>Latest Subscriber</h3>
                            <p>Show the most recent subscriber with animation</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={safeSettings.showLatestSub}
                              onChange={(e) => handleSettingsChange({ showLatestSub: e.target.checked })}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                      </div>

                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">🏆</div>
                          <div className="setting-details">
                            <h3>Gift Sub Leaderboard</h3>
                            <p>Show top gift subscription contributors</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={safeSettings.showSubLeaderboard}
                              onChange={(e) => handleSettingsChange({ showSubLeaderboard: e.target.checked })}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                      </div>

                      {safeSettings.showSubLeaderboard && (
                        <div className="setting-item sub-setting">
                          <div className="setting-info">
                            <div className="setting-icon">📊</div>
                            <div className="setting-details">
                              <h3>Leaderboard Size</h3>
                              <p>Number of top contributors to display</p>
                            </div>
                          </div>
                          <div className="setting-control">
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={safeSettings.kickLeaderboardSize}
                              onChange={(e) => handleSettingsChange({ kickLeaderboardSize: parseInt(e.target.value) || 5 })}
                              onBlur={(e) => {
                                const value = parseInt(e.target.value);
                                if (isNaN(value) || value < 1) {
                                  handleSettingsChange({ kickLeaderboardSize: 5 });
                                }
                              }}
                              className="number-input"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Advanced Features */}
                  {safeSettings.showKickSubGoal && (
                    <div className="settings-group">
                      <div className="group-header">
                        <h3>Advanced Features</h3>
                      </div>
                      
                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">🔄</div>
                          <div className="setting-details">
                            <h3>Rolling Sub Goal</h3>
                            <p>Automatically increase goal after completion</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={safeSettings.enableRollingSubGoal}
                              onChange={(e) => handleSettingsChange({ enableRollingSubGoal: e.target.checked })}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                      </div>

                      {safeSettings.enableRollingSubGoal && (
                        <>
                          <div className="setting-item sub-setting">
                            <div className="setting-info">
                              <div className="setting-icon">📈</div>
                              <div className="setting-details">
                                <h3>Goal Increment</h3>
                                <p>Next goal will be a multiple of this number (e.g., 10 = goals of 10, 20, 30...)</p>
                              </div>
                            </div>
                            <div className="setting-control">
                              <input
                                type="number"
                                min="1"
                                max="20"
                                value={safeSettings.rollingSubGoalIncrement}
                                onChange={(e) => handleSettingsChange({ rollingSubGoalIncrement: parseInt(e.target.value) || 5 })}
                                onBlur={(e) => {
                                  const value = parseInt(e.target.value);
                                  if (isNaN(value) || value < 1) {
                                    handleSettingsChange({ rollingSubGoalIncrement: 5 });
                                  }
                                }}
                                className="number-input"
                              />
                            </div>
                          </div>

                          <div className="setting-item sub-setting">
                            <div className="setting-info">
                              <div className="setting-icon">⏱️</div>
                              <div className="setting-details">
                                <h3>Goal Delay</h3>
                                <p>Minutes to wait before increasing goal</p>
                              </div>
                            </div>
                            <div className="setting-control">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={safeSettings.rollingSubGoalDelay}
                                onChange={(e) => handleSettingsChange({ rollingSubGoalDelay: parseInt(e.target.value) || 5 })}
                                onBlur={(e) => {
                                  const value = parseInt(e.target.value);
                                  if (isNaN(value) || value < 1) {
                                    handleSettingsChange({ rollingSubGoalDelay: 5 });
                                  }
                                }}
                                className="number-input"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Manual Override */}
                  {safeSettings.showKickSubGoal && (
                    <div className="settings-group">
                      <div className="group-header">
                        <h3>Manual Override</h3>
                        <div className="info-text" style={{ marginTop: '8px' }}>
                          Channel: <strong>Tazo</strong>
                        </div>
                      </div>
                      
                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">🔢</div>
                          <div className="setting-details">
                            <h3>Manual Sub Count</h3>
                            <p>Override the current subscription count</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <div className="manual-override-controls">
                            <input
                              type="number"
                              min="0"
                              max="9999"
                              value={manualSubCount !== '' ? manualSubCount : currentSubCount.toString()}
                              onChange={(e) => setManualSubCount(e.target.value)}
                              placeholder="0"
                              className="number-input manual-input"
                              onFocus={() => console.log('Admin: Manual sub count input focused - currentSubCount:', currentSubCount, 'manualSubCount:', manualSubCount)}
                            />
                            <button 
                              onClick={handleManualSubCountUpdate}
                              className="admin-button manual-button"
                            >
                              Update
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">👤</div>
                          <div className="setting-details">
                            <h3>Manual Latest Sub</h3>
                            <p>Override the latest subscriber name</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <div className="manual-override-controls">
                            <input
                              type="text"
                              value={manualLatestSub !== '' ? manualLatestSub : currentLatestSub}
                              onChange={(e) => setManualLatestSub(e.target.value)}
                              placeholder="Username"
                              className="text-input manual-input"
                              onFocus={() => console.log('Admin: Manual latest sub input focused - currentLatestSub:', currentLatestSub, 'manualLatestSub:', manualLatestSub)}
                            />
                            <button 
                              onClick={handleManualLatestSubUpdate}
                              className="admin-button manual-button"
                            >
                              Update
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="setting-item sub-setting">
                        <div className="setting-info">
                          <div className="setting-icon">🔄</div>
                          <div className="setting-details">
                            <h3>Reset Sub Goal</h3>
                            <p>Reset sub count to 0 and clear latest subscriber</p>
                          </div>
                        </div>
                        <div className="setting-control">
                          <button 
                            onClick={handleResetSubGoal}
                            className="admin-button manual-button reset-button"
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                    </div>
                  )}
                  
                </div>
              </div>
            )}


          </div>

          {/* Footer */}
          <div className="admin-footer">
            <div className="footer-content">
              <div className="footer-status">
                <div className="status-indicator"></div>
                <span>Auto-save enabled</span>
              </div>
            </div>
          </div>
        </div>

        {/* Toast Notification */}
        {showToast && (
          <div className={`toast ${toastMessage.includes('Failed') ? 'error' : 'success'}`}>
            <span className="toast-icon">{toastMessage.includes('Failed') ? '❌' : '✓'}</span>
            <span className="toast-text">{toastMessage}</span>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
} 