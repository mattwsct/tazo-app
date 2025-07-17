"use client";

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import '@/styles/admin.css';

// === 🎛️ ADMIN PANEL LOGGER ===
const AdminLogger = {
  info: (message: string, data?: unknown) => 
    console.log(`🎛️ [ADMIN PANEL] ${message}`, data || ''),
  
  auth: (message: string, data?: unknown) => 
    console.log(`🔐 [ADMIN AUTH] ${message}`, data || ''),
  
  settings: (message: string, data?: unknown) => 
    console.log(`⚙️ [ADMIN SETTINGS] ${message}`, data || ''),
  
  error: (message: string, error?: unknown) => 
    console.error(`❌ [ADMIN ERROR] ${message}`, error || ''),
  
  warn: (message: string, data?: unknown) => 
    console.warn(`⚠️ [ADMIN WARNING] ${message}`, data || ''),
} as const;

// === 🎛️ ADMIN PANEL COMPONENT ===
export default function AdminPage() {
  AdminLogger.info('Admin panel initialized');

  // === 🔐 AUTHENTICATION STATE ===
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // === ⚙️ SETTINGS STATE ===
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  
  // === 💬 UI STATE ===
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [saveToastMessage, setSaveToastMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // === 🔐 SESSION MANAGEMENT ===
  
  // Check for existing session on load
  useEffect(() => {
    AdminLogger.auth('Checking for existing authentication session');
    const savedAuth = localStorage.getItem('admin_authenticated');
    if (savedAuth === 'true') {
      AdminLogger.auth('Found valid session - authenticating user');
      setIsAuthenticated(true);
    } else {
      AdminLogger.auth('No valid session found - user needs to login');
    }
  }, []);

  // Load current settings when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      AdminLogger.settings('User authenticated - loading current settings');
      setIsLoading(true);
      
      authenticatedFetch('/api/get-settings')
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then(data => {
          AdminLogger.settings('Settings loaded successfully', data);
          setSettings(data);
        })
        .catch(err => {
          AdminLogger.error('Failed to load settings', err);
          showToast('Failed to load settings. Please refresh the page.', 'error');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isAuthenticated]);

  // === 💬 TOAST NOTIFICATION SYSTEM ===
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    AdminLogger.info(`Showing ${type} toast: ${message}`);
    setSaveToastMessage(message);
    setShowSaveToast(true);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      setShowSaveToast(false);
    }, 3000);
  };

  // === 🔐 AUTHENTICATION HANDLERS ===
  const handleLogin = async () => {
    if (!password.trim()) {
      AdminLogger.warn('Login attempted with empty password');
      showToast('Please enter a password', 'error');
      return;
    }

    AdminLogger.auth('Attempting login...');
    setIsLoading(true);

    try {
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (response.ok) {
        AdminLogger.auth('Login successful - setting up session');
        setIsAuthenticated(true);
        localStorage.setItem('admin_authenticated', 'true');
        setPassword(''); // Clear password field for security
        showToast('Successfully logged in!', 'success');
      } else {
        AdminLogger.auth('Login failed - incorrect password');
        showToast('Incorrect password. Please try again.', 'error');
      }
    } catch (error) {
      AdminLogger.error('Login request failed', error);
      showToast('Login failed. Please check your connection and try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    AdminLogger.auth('User logging out - clearing session');
    setIsAuthenticated(false);
    localStorage.removeItem('admin_authenticated');
    setPassword('');
    setSettings(DEFAULT_OVERLAY_SETTINGS);
    showToast('Successfully logged out', 'success');
  };

  // === ⚙️ SETTINGS HANDLERS ===
  const handleSettingsChange = (newSettings: Partial<OverlaySettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    AdminLogger.settings('Settings changed locally', { 
      changed: newSettings, 
      full: updatedSettings 
    });
    setSettings(updatedSettings);
  };

  const handleSaveSettings = async () => {
    AdminLogger.settings('Attempting to save settings', settings);
    setIsLoading(true);

    try {
      const response = await authenticatedFetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      AdminLogger.settings('Settings saved successfully', result);
      showToast('Settings saved successfully!', 'success');
    } catch (error) {
      AdminLogger.error('Failed to save settings', error);
      showToast('Failed to save settings. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // === 📧 KEYBOARD HANDLERS ===
  const handlePasswordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleLogin();
    }
  };

  // === 🎨 RENDER LOGIN FORM ===
  if (!isAuthenticated) {
    return (
      <div className="admin-container">
        <div className="admin-content">
          <div className="admin-login">
            <h1>🎮 Admin Panel</h1>
            <p>Configure your streaming overlay settings</p>
            
            <div className="form-group">
              <label htmlFor="password">Password:</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handlePasswordKeyPress}
                placeholder="Enter admin password"
                disabled={isLoading}
                className={isLoading ? 'loading' : ''}
              />
            </div>
            
            <button 
              onClick={handleLogin} 
              disabled={isLoading}
              className={`primary ${isLoading ? 'loading' : ''}`}
            >
              {isLoading ? '🔄 Logging in...' : '🔐 Login'}
            </button>
          </div>
        </div>

        {/* Toast Notification */}
        {showSaveToast && (
          <div className={`toast ${saveToastMessage.includes('Failed') ? 'error' : 'success'}`}>
            {saveToastMessage}
          </div>
        )}
      </div>
    );
  }

  // === 🎨 RENDER ADMIN PANEL ===
  return (
    <div className="admin-container">
      <div className="admin-content">
        <div className="admin-header">
          <h1>🎮 Streaming Overlay Admin</h1>
          <p>Configure your live stream overlay settings</p>
          <button onClick={handleLogout} className="logout-btn">
            🚪 Logout
          </button>
        </div>

        {isLoading && (
          <div className="loading-indicator">
            <span>🔄 Loading...</span>
          </div>
        )}

        <div className="settings-grid">
          {/* ⏰ Time Settings */}
          <div className="settings-section">
            <h2>⏰ Time Display</h2>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showTime}
                  onChange={(e) => handleSettingsChange({ showTime: e.target.checked })}
                />
                <span className="checkmark"></span>
                Show current time
              </label>
              <p className="help-text">Displays local time based on current timezone</p>
            </div>
          </div>

          {/* 📍 Location Settings */}
          <div className="settings-section">
            <h2>📍 Location Display</h2>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showLocation}
                  onChange={(e) => handleSettingsChange({ showLocation: e.target.checked })}
                />
                <span className="checkmark"></span>
                Show current location
              </label>
              <p className="help-text">Displays city/state and country with flag</p>
            </div>
          </div>

          {/* 🌤️ Weather Settings */}
          <div className="settings-section">
            <h2>🌤️ Weather Display</h2>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showWeather}
                  onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                />
                <span className="checkmark"></span>
                Show current weather
              </label>
              <p className="help-text">Temperature and conditions from Open-Meteo</p>
            </div>
            
            {settings.showWeather && (
              <>
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showWeatherIcon}
                      onChange={(e) => handleSettingsChange({ showWeatherIcon: e.target.checked })}
                    />
                    <span className="checkmark"></span>
                    Show weather icon
                  </label>
                </div>
                
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showWeatherCondition}
                      onChange={(e) => handleSettingsChange({ showWeatherCondition: e.target.checked })}
                    />
                    <span className="checkmark"></span>
                    Show weather description
                  </label>
                </div>
                
                <div className="form-group">
                  <label htmlFor="iconPosition">Weather icon position:</label>
                  <select
                    id="iconPosition"
                    value={settings.weatherIconPosition}
                    onChange={(e) => handleSettingsChange({ 
                      weatherIconPosition: e.target.value as 'left' | 'right' 
                    })}
                  >
                    <option value="right">Right of temperature</option>
                    <option value="left">Left of temperature</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* 🗺️ Minimap Settings */}
          <div className="settings-section">
            <h2>🗺️ GPS Minimap</h2>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showMinimap}
                  onChange={(e) => handleSettingsChange({ showMinimap: e.target.checked })}
                />
                <span className="checkmark"></span>
                Show minimap manually
              </label>
              <p className="help-text">Always show minimap regardless of movement</p>
            </div>
            
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={settings.minimapSpeedBased}
                  onChange={(e) => handleSettingsChange({ minimapSpeedBased: e.target.checked })}
                />
                <span className="checkmark"></span>
                Auto-show when moving
              </label>
              <p className="help-text">Show minimap automatically when speed ≥ 10 km/h</p>
            </div>
            
            <div className="info-box">
              <h4>🎯 Minimap Behavior</h4>
              <ul>
                <li><strong>Manual:</strong> Shows/hides based on toggle above</li>
                <li><strong>Speed-based:</strong> Auto-appears when moving fast</li>
                <li><strong>Both enabled:</strong> Shows in either condition</li>
                <li><strong>3D view:</strong> Buildings and realistic perspective</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 💾 Save Settings */}
        <div className="save-section">
          <button 
            onClick={handleSaveSettings} 
            disabled={isLoading}
            className={`save-btn ${isLoading ? 'loading' : ''}`}
          >
            {isLoading ? '🔄 Saving...' : '💾 Save Settings'}
          </button>
          <p className="help-text">
            Changes are applied in real-time to the overlay
          </p>
        </div>

        {/* 📖 Information Section */}
        <div className="info-section">
          <h2>📖 Usage Information</h2>
          <div className="info-grid">
            <div className="info-card">
              <h3>🎮 Overlay URL</h3>
              <p>Add this URL as a Browser Source in OBS:</p>
              <code>{window.location.origin}/overlay</code>
            </div>
            
            <div className="info-card">
              <h3>💗 Heart Rate Monitor</h3>
              <p>Heart rate display appears automatically when:</p>
              <ul>
                <li>Pulsoid token is configured</li>
                <li>Heart rate monitor is connected</li>
                <li>BPM data is being received</li>
              </ul>
            </div>
            
            <div className="info-card">
              <h3>🗺️ GPS Minimap</h3>
              <p>Minimap status:</p>
              <ul>
                <li><strong>Token:</strong> {process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ? '✅ Configured' : '❌ Missing'}</li>
                <li><strong>Required:</strong> NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</li>
                <li><strong>Get token:</strong> <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" style={{color: '#22c55e'}}>Mapbox Account</a></li>
                <li><strong>3D view:</strong> Buildings and realistic perspective</li>
              </ul>
            </div>
            
            <div className="info-card">
              <h3>🔧 Technical Details</h3>
              <ul>
                <li><strong>Real-time updates:</strong> Settings change instantly</li>
                <li><strong>GPS tracking:</strong> Updates on 100m+ movement</li>
                <li><strong>Weather data:</strong> Refreshes every 5 minutes</li>
                <li><strong>Auto-hide:</strong> Elements hide when data unavailable</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {showSaveToast && (
        <div className={`toast ${saveToastMessage.includes('Failed') ? 'error' : 'success'}`}>
          {saveToastMessage}
        </div>
      )}
    </div>
  );
} 