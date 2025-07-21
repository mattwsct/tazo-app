"use client";

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode } from '@/types/settings';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRenderPerformance } from '@/lib/performance';
import '@/styles/admin.css';

export default function AdminPage() {
  // Performance monitoring
  useRenderPerformance('AdminPage');
  
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
              // Not authenticated - use default settings
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
            setSettings(data);
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
    setIsAuthenticated(false);
    localStorage.removeItem('admin_authenticated');
    setPassword('');
    setSettings(DEFAULT_OVERLAY_SETTINGS);
    showToastMessage('Successfully logged out');
  };

  // === ⚙️ SETTINGS HANDLERS ===
  const handleSettingsChange = async (newSettings: Partial<OverlaySettings>) => {
    let updatedSettings = { ...settings, ...newSettings };
    
    // Auto-disable minimap settings when location is hidden
    if (newSettings.locationDisplay === 'hidden') {
      updatedSettings = {
        ...updatedSettings,
        showMinimap: false,
        minimapSpeedBased: false,
      };
    }
    // Auto-enable minimapSpeedBased when city is selected
    if (newSettings.locationDisplay === 'city') {
      updatedSettings = {
        ...updatedSettings,
        minimapSpeedBased: true,
      };
    }
    // Auto-disable minimapSpeedBased when state or country is selected
    if (newSettings.locationDisplay === 'state' || newSettings.locationDisplay === 'country') {
      updatedSettings = {
        ...updatedSettings,
        minimapSpeedBased: false,
      };
    }
    
    setSettings(updatedSettings);
    
    // Auto-save on every change
    try {
      const response = await authenticatedFetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - this is expected when not logged in
          console.log('Not authenticated, settings not saved');
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      showToastMessage('Saved');
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

        {/* Settings Container */}
        <div className="settings-container">
          <div className="settings-header">
            <h2>Overlay Settings</h2>
            <p>Toggle features on/off for your stream</p>
          </div>

          <div className="settings-list">


            {/* Location Display */}
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-icon">📍</div>
                <div className="setting-details">
                  <h3>Location Display</h3>
                  <p>Choose location format or hide completely</p>
                </div>
              </div>
              <div className="setting-control">
                <div className="location-options">
                  <label className={`location-option ${settings.locationDisplay === 'city' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="locationDisplay"
                      value="city"
                      checked={settings.locationDisplay === 'city'}
                      onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                    />
                    <span className="option-icon">🏙️</span>
                    <span className="option-text">City</span>
                  </label>
                  
                  <label className={`location-option ${settings.locationDisplay === 'state' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="locationDisplay"
                      value="state"
                      checked={settings.locationDisplay === 'state'}
                      onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                    />
                    <span className="option-icon">🗺️</span>
                    <span className="option-text">State</span>
                  </label>
                  
                  <label className={`location-option ${settings.locationDisplay === 'country' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="locationDisplay"
                      value="country"
                      checked={settings.locationDisplay === 'country'}
                      onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                    />
                    <span className="option-icon">🌍</span>
                    <span className="option-text">Country</span>
                  </label>
                  
                  <label className={`location-option ${settings.locationDisplay === 'hidden' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="locationDisplay"
                      value="hidden"
                      checked={settings.locationDisplay === 'hidden'}
                      onChange={(e) => handleSettingsChange({ locationDisplay: e.target.value as LocationDisplayMode })}
                    />
                    <span className="option-icon">🚫</span>
                    <span className="option-text">Hidden</span>
                  </label>
                </div>
              </div>
            </div>

            {/* GPS Minimap - Only show if location is not hidden */}
            {settings.locationDisplay && settings.locationDisplay !== 'hidden' && (
              <div className="setting-item sub-setting">
                <div className="setting-info">
                  <div className="setting-icon">🗺️</div>
                  <div className="setting-details">
                    <h3>GPS Minimap</h3>
                    <p>Show live location map</p>
                  </div>
                </div>
                <div className="setting-control">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.showMinimap}
                      onChange={(e) => handleSettingsChange({ showMinimap: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            )}

            {/* Auto-show when moving - Only show if location is not hidden */}
            {settings.locationDisplay && settings.locationDisplay !== 'hidden' && (
              <div className="setting-item sub-setting">
                <div className="setting-info">
                  <div className="setting-icon">🏃</div>
                  <div className="setting-details">
                    <h3>Auto-show when moving</h3>
                    <p>Display minimap only when traveling</p>
                  </div>
                </div>
                <div className="setting-control">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.minimapSpeedBased}
                      onChange={(e) => handleSettingsChange({ minimapSpeedBased: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            )}

            {/* Weather Display */}
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-icon">🌤️</div>
                <div className="setting-details">
                  <h3>Weather Display</h3>
                  <p>Show temperature and conditions</p>
                </div>
              </div>
              <div className="setting-control">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.showWeather}
                    onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>


          </div>
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
      </div> {/* <-- Properly close admin-content here */}

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