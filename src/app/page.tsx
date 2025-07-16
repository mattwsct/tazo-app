"use client";

import { useState, useEffect } from 'react';

interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showSpeed: boolean;
  showTime: boolean;
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>({
    showLocation: true,
    showWeather: true,
    showSpeed: true,
    showTime: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [currentTimezone, setCurrentTimezone] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ label: string; countryCode: string } | null>(null);

  // Check for existing session on load
  useEffect(() => {
    const savedAuth = localStorage.getItem('admin_authenticated');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Load current settings when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/get-settings')
        .then(res => res.json())
        .then(data => {
          console.log('Loaded current settings:', data);
          setSettings(data);
        })
        .catch(err => console.error('Failed to load current settings:', err));
    }
  }, [isAuthenticated]);

  // Load current location when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/get-location')
        .then(res => res.json())
        .then(data => {
          if (data) {
            console.log('Loaded current location:', data);
            setCurrentLocation(data);
          }
        })
        .catch(err => console.error('Failed to load current location:', err));
    }
  }, [isAuthenticated]);

  // Load current timezone (simplified for admin display)
  useEffect(() => {
    if (isAuthenticated) {
      // Get timezone from browser
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setCurrentTimezone(timezone);
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (response.ok) {
        setIsAuthenticated(true);
        localStorage.setItem('admin_authenticated', 'true');
        setPassword(''); // Clear password field
      } else {
        alert('Incorrect password');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('admin_authenticated');
  };

  const saveSettings = async (newSettings = settings, showAlert = true) => {
    if (!showAlert) setIsSaving(true);
    try {
      await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      if (showAlert) {
        alert('Settings saved!');
      }
    } catch (error) {
      if (showAlert) {
        alert('Failed to save settings');
      }
      console.error('Failed to save settings:', error);
    } finally {
      if (!showAlert) {
        setTimeout(() => setIsSaving(false), 500); // Show saving indicator briefly
      }
    }
  };

  const updateSetting = async (key: keyof OverlaySettings, value: boolean | string) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await saveSettings(newSettings, false); // Auto-save without alert
  };

  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#111',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Montserrat, sans-serif'
      }}>
        <div style={{
          backgroundColor: '#222',
          padding: '32px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          maxWidth: '400px',
          width: '100%'
        }}>
          <h1 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            marginBottom: '24px',
            textAlign: 'center'
          }}>Admin Panel</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '4px',
                color: 'white',
                fontSize: '16px'
              }}
            />
            <button
              onClick={handleLogin}
              style={{
                width: '100%',
                backgroundColor: '#0066cc',
                color: 'white',
                padding: '12px',
                borderRadius: '4px',
                border: 'none',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      minHeight: '100vh',
      overflowX: 'hidden'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          flexDirection: window.innerWidth < 768 ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: window.innerWidth < 768 ? 'stretch' : 'center',
          gap: '16px',
          marginBottom: '32px',
          padding: '24px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: 'linear-gradient(45deg, #22c55e, #16a34a)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              ⚡
            </div>
            <div>
              <h1 style={{ 
                fontSize: window.innerWidth < 768 ? '24px' : '32px', 
                fontWeight: '700', 
                margin: 0,
                background: 'linear-gradient(45deg, #ffffff, #e2e8f0)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Overlay Control Center
              </h1>
              <p style={{ 
                margin: '4px 0 0 0', 
                fontSize: '14px', 
                opacity: 0.8,
                fontWeight: '400'
              }}>
                Real-time streaming overlay management
              </p>
            </div>
            {isSaving && (
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(34, 197, 94, 0.2)',
                borderRadius: '20px',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                fontSize: '12px',
                fontWeight: '600'
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  background: '#22c55e',
                  borderRadius: '50%',
                  animation: 'pulse 2s infinite'
                }} />
                Auto-saved
              </div>
            )}
          </div>
          <div style={{ 
            display: 'flex', 
            gap: '12px',
            flexDirection: window.innerWidth < 768 ? 'column' : 'row',
            width: window.innerWidth < 768 ? '100%' : 'auto'
          }}>
            <button
              onClick={() => window.open('/overlay', '_blank')}
              style={{
                background: 'linear-gradient(45deg, #22c55e, #16a34a)',
                color: 'white',
                padding: '12px 20px',
                borderRadius: '10px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(34, 197, 94, 0.3)',
                transition: 'all 0.2s ease',
                minHeight: '44px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(34, 197, 94, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(34, 197, 94, 0.3)';
              }}
            >
              <span>🚀</span>
              Open Overlay
            </button>
            <button
              onClick={handleLogout}
              style={{
                background: 'linear-gradient(45deg, #dc2626, #b91c1c)',
                color: 'white',
                padding: '12px 20px',
                borderRadius: '10px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(220, 38, 38, 0.3)',
                transition: 'all 0.2s ease',
                minHeight: '44px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(220, 38, 38, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(220, 38, 38, 0.3)';
              }}
            >
              <span>👋</span>
              Logout
            </button>
          </div>
        </div>

        {/* Settings Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: window.innerWidth < 768 ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
          marginBottom: '32px'
        }}>
          {/* Display Settings */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '28px',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '24px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px'
              }}>
                ⚙️
              </div>
              <h2 style={{ 
                fontSize: '22px', 
                fontWeight: '700', 
                margin: 0,
                background: 'linear-gradient(45deg, #ffffff, #e2e8f0)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Display Settings
              </h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {[
                { 
                  key: 'showTime', 
                  label: 'Time Display', 
                  icon: '🕐', 
                  desc: 'Show current local time',
                  extra: currentTimezone ? `Timezone: ${currentTimezone}` : null
                },
                { 
                  key: 'showLocation', 
                  label: 'Location Display', 
                  icon: '📍', 
                  desc: 'Show current city and country',
                  extra: currentLocation ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{currentLocation.label}</span>
                      {currentLocation.countryCode && (
                        <img
                          src={`https://flagcdn.com/${currentLocation.countryCode}.svg`}
                          alt={`Country: ${currentLocation.label}`}
                          style={{
                            width: '16px',
                            height: '11px',
                            borderRadius: '1px',
                            border: '1px solid rgba(255, 255, 255, 0.2)'
                          }}
                        />
                      )}
                    </div>
                  ) : 'No location data'
                },
                { key: 'showWeather', label: 'Weather Display', icon: '🌤️', desc: 'Show temperature and conditions' },
                { key: 'showSpeed', label: 'Speed Display', icon: '🚗', desc: 'Show speed when moving >10 km/h' }
              ].map(({ key, label, icon, desc, extra }) => (
                <div key={key} style={{
                  padding: '16px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s ease'
                }}>
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'flex-start', 
                    gap: '16px', 
                    cursor: 'pointer',
                    width: '100%'
                  }}>
                    <div style={{
                      position: 'relative',
                      width: '48px',
                      height: '28px',
                      background: settings[key as keyof OverlaySettings] ? '#22c55e' : 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '14px',
                      transition: 'all 0.3s ease',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: '2px',
                        left: settings[key as keyof OverlaySettings] ? '22px' : '2px',
                        width: '24px',
                        height: '24px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
                      }} />
                      <input
                        type="checkbox"
                        checked={settings[key as keyof OverlaySettings]}
                        onChange={(e) => updateSetting(key as keyof OverlaySettings, e.target.checked)}
                        style={{ 
                          opacity: 0, 
                          position: 'absolute', 
                          width: '100%', 
                          height: '100%',
                          cursor: 'pointer'
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px'
                      }}>
                        <span style={{ fontSize: '18px' }}>{icon}</span>
                        <span style={{ 
                          fontSize: '16px', 
                          fontWeight: '600',
                          color: 'white'
                        }}>
                          {label}
                        </span>
                      </div>
                      <p style={{
                        margin: 0,
                        fontSize: '13px',
                        opacity: 0.7,
                        lineHeight: '1.4'
                      }}>
                        {desc}
                      </p>
                      {extra && (
                        <div style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: '#22c55e',
                          fontWeight: '500'
                        }}>
                          {extra}
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>



        {/* Current Settings Debug */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.2)',
          padding: '20px',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              background: 'linear-gradient(45deg, #8b5cf6, #7c3aed)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px'
            }}>
              🔧
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              margin: 0,
              opacity: 0.9
            }}>
              Current Configuration
            </h3>
          </div>
          
          <div style={{
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '16px',
            borderRadius: '8px',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace'
          }}>
            <pre style={{
              fontSize: '13px',
              color: '#e2e8f0',
              overflow: 'auto',
              margin: 0,
              lineHeight: '1.5'
            }}>
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
} 