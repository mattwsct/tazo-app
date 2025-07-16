"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';

interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
  showSpeed: boolean;
  showTime: boolean;
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>({
    showLocation: true,
    showWeather: true,
    showWeatherIcon: true,
    showWeatherCondition: true,
    weatherIconPosition: 'left' as 'left' | 'right',
    showSpeed: true,
    showTime: true,
  });
  const [currentTimezone, setCurrentTimezone] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ label: string; countryCode: string } | null>(null);
  const [currentWeather, setCurrentWeather] = useState<{ temp: number; icon: string; desc: string } | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [saveToastMessage, setSaveToastMessage] = useState('');

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

  // Load current weather when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/get-weather')
        .then(res => res.json())
        .then(data => {
          if (data) {
            console.log('Loaded current weather:', data);
            setCurrentWeather(data);
          }
        })
        .catch(err => console.error('Failed to load current weather:', err));
    }
  }, [isAuthenticated]);

  // Manual location capture function
  const getManualLocation = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser');
      return;
    }

    setIsGettingLocation(true);
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          
          // Save GPS coordinates to KV
          await fetch('/api/save-gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latitude, lon: longitude })
          });

          // Get location name from coordinates (using the overlay's method)
          // This will trigger location name lookup and weather update
          const locationResponse = await fetch(`https://us1.locationiq.com/v1/reverse.php?key=${process.env.NEXT_PUBLIC_LOCATIONIQ_KEY}&lat=${latitude}&lon=${longitude}&format=json&accept-language=en`);
          
          if (locationResponse.ok) {
            const data = await locationResponse.json();
            if (data.address) {
              const city = data.address.city || data.address.town || data.address.municipality || data.address.suburb;
              const countryCode = data.address.country_code ? data.address.country_code.toLowerCase() : '';
              const label = city ? `${city}, ${data.address.country}` : data.address.country;
              
              if (label && countryCode) {
                // Save formatted location
                await fetch('/api/save-location', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ label, countryCode })
                });
                
                setCurrentLocation({ label, countryCode });
                
                // Get weather for this location
                const weatherResponse = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${process.env.NEXT_PUBLIC_OPENWEATHER_KEY}&units=metric`);
                
                if (weatherResponse.ok) {
                  const weatherData = await weatherResponse.json();
                  if (weatherData.cod === 200 && weatherData.weather && weatherData.weather[0] && weatherData.main) {
                    const weather = {
                      temp: Math.round(weatherData.main.temp),
                      icon: weatherData.weather[0].icon,
                      desc: weatherData.weather[0].description,
                    };
                    setCurrentWeather(weather);
                    
                    // Save weather to KV
                    await fetch('/api/save-weather', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(weather)
                    });
                  }
                }
              }
            }
          }
          
          alert('Location updated successfully!');
        } catch (error) {
          console.error('Error processing location:', error);
          alert('Failed to process location');
        } finally {
          setIsGettingLocation(false);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Failed to get location: ' + error.message);
        setIsGettingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

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
    const startTime = Date.now();
    
    try {
      const response = await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      
      const result = await response.json();
      const clientTime = Date.now() - startTime;
      
      console.log(`Settings save complete - Client: ${clientTime}ms, Server: ${result.saveTime || 'unknown'}ms`);
      
      if (showAlert) {
        alert(`Settings saved! (${clientTime}ms)`);
      } else {
        // Show toast notification for auto-saves
        setSaveToastMessage(`Saved (${clientTime}ms)`);
        setShowSaveToast(true);
        setTimeout(() => setShowSaveToast(false), 2000);
      }
    } catch (error) {
      const clientTime = Date.now() - startTime;
      console.error(`Settings save failed after ${clientTime}ms:`, error);
      
      if (showAlert) {
        alert('Failed to save settings');
      } else {
        setSaveToastMessage('Save failed');
        setShowSaveToast(true);
        setTimeout(() => setShowSaveToast(false), 3000);
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
        backgroundColor: '#0a0a0a',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          backgroundColor: '#1a1a1a',
          padding: '32px',
          borderRadius: '12px',
          border: '1px solid #333',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
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
      background: '#0a0a0a',
      color: '#e2e8f0',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
      overflowX: 'hidden'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Mobile-First Header */}
        <div style={{
          marginBottom: '24px',
          background: '#1a1a1a',
          borderRadius: '16px',
          border: '1px solid #333',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden'
        }}>
          {/* Title Section */}
          <div style={{
            padding: '20px 20px 16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: 'linear-gradient(45deg, #22c55e, #16a34a)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              flexShrink: 0
            }}>
              ⚡
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ 
                fontSize: '28px', 
                fontWeight: '700', 
                margin: 0,
                color: '#ffffff',
                lineHeight: '1.2'
              }}>
                Control Center
              </h1>
              <p style={{ 
                margin: '4px 0 0 0', 
                fontSize: '14px', 
                opacity: 0.8,
                fontWeight: '400'
              }}>
                Real-time overlay management
              </p>
            </div>

          </div>
          
          {/* Action Buttons */}
          <div style={{
            padding: '0 20px 20px 20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '12px'
          }}>
            <button
              onClick={() => window.open('/overlay', '_blank')}
              style={{
                background: 'linear-gradient(45deg, #10b981, #059669)',
                color: 'white',
                padding: '14px 16px',
                borderRadius: '12px',
                border: '1px solid #065f46',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                transition: 'all 0.2s ease',
                minHeight: '48px',
                position: 'relative'
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
              <span style={{ fontSize: '16px' }}>🚀</span>
              <span>Open Overlay</span>
            </button>
            
            <button
              onClick={getManualLocation}
              disabled={isGettingLocation}
              style={{
                background: isGettingLocation 
                  ? 'linear-gradient(45deg, #94a3b8, #64748b)' 
                  : 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                color: 'white',
                padding: '14px 16px',
                borderRadius: '12px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '600',
                cursor: isGettingLocation ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.3)',
                transition: 'all 0.2s ease',
                minHeight: '48px',
                opacity: isGettingLocation ? 0.7 : 1
              }}
              onMouseEnter={(e) => {
                if (!isGettingLocation) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isGettingLocation) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.3)';
                }
              }}
            >
              <span style={{ fontSize: '16px' }}>{isGettingLocation ? '⏳' : '📍'}</span>
              <span>{isGettingLocation ? 'Getting...' : 'Update Location'}</span>
            </button>
            
            <button
              onClick={handleLogout}
              style={{
                background: 'linear-gradient(45deg, #dc2626, #b91c1c)',
                color: 'white',
                padding: '14px 16px',
                borderRadius: '12px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(220, 38, 38, 0.3)',
                transition: 'all 0.2s ease',
                minHeight: '48px'
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
              <span style={{ fontSize: '16px' }}>👋</span>
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Settings Section */}
        <div style={{
          background: '#1a1a1a',
          borderRadius: '16px',
          border: '1px solid #333',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden'
        }}>
          {/* Settings Header */}
          <div style={{
            padding: '24px 20px 16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
              }}>
                ⚙️
              </div>
              <div>
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
                <p style={{
                  margin: '2px 0 0 0',
                  fontSize: '13px',
                  opacity: 0.7
                }}>
                  Configure what appears on your streaming overlay
                </p>
              </div>
            </div>
          </div>
          
          {/* Settings Controls */}
          <div style={{
            padding: '20px'
          }}>
            <div style={{ 
              display: 'grid',
              gap: '16px'
            }}>
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
                        <Image
                          src={`https://flagcdn.com/${currentLocation.countryCode}.svg`}
                          alt={`Country: ${currentLocation.label}`}
                          width={16}
                          height={11}
                          style={{
                            borderRadius: '1px',
                            border: '1px solid rgba(255, 255, 255, 0.2)'
                          }}
                          unoptimized
                        />
                      )}
                    </div>
                  ) : 'No location data'
                },
                { 
                  key: 'showWeather', 
                  label: 'Weather Display', 
                  icon: '🌤️', 
                  desc: 'Show temperature and conditions',
                  extra: currentWeather ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{currentWeather.temp}°C</span>
                      <span style={{ textTransform: 'capitalize' }}>{currentWeather.desc}</span>
                    </div>
                  ) : 'No weather data'
                },
                { key: 'showSpeed', label: 'Speed Display', icon: '🚗', desc: 'Show speed when moving >10 km/h' }
              ].map(({ key, label, icon, desc, extra }) => (
                <div key={key} style={{
                  background: '#262626',
                  borderRadius: '12px',
                  border: '1px solid #404040',
                  padding: '20px',
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
                      width: '52px',
                      height: '32px',
                      background: (settings[key as keyof OverlaySettings] as boolean)
                        ? 'linear-gradient(45deg, #22c55e, #16a34a)' 
                        : 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '16px',
                      transition: 'all 0.3s ease',
                      cursor: 'pointer',
                      flexShrink: 0,
                      boxShadow: settings[key as keyof OverlaySettings] 
                        ? '0 4px 12px rgba(34, 197, 94, 0.3)' 
                        : '0 2px 8px rgba(0, 0, 0, 0.1)'
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: '2px',
                        left: settings[key as keyof OverlaySettings] ? '22px' : '2px',
                        width: '28px',
                        height: '28px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px'
                      }}>
                        {(settings[key as keyof OverlaySettings] as boolean) ? '✓' : ''}
                      </div>
                      <input
                        type="checkbox"
                        checked={settings[key as keyof OverlaySettings] as boolean}
                        onChange={(e) => updateSetting(key as keyof OverlaySettings, e.target.checked)}
                        style={{ 
                          opacity: 0, 
                          position: 'absolute', 
                          width: '100%', 
                          height: '100%',
                          cursor: 'pointer',
                          margin: 0
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '6px',
                        flexWrap: 'wrap'
                      }}>
                        <span style={{ fontSize: '20px' }}>{icon}</span>
                        <span style={{ 
                          fontSize: '18px', 
                          fontWeight: '600',
                          color: 'white'
                        }}>
                          {label}
                        </span>
                      </div>
                      <p style={{
                        margin: '0 0 8px 0',
                        fontSize: '14px',
                        opacity: 0.8,
                        lineHeight: '1.4'
                      }}>
                        {desc}
                      </p>
                      {extra && (
                        <div style={{
                          padding: '8px 12px',
                          background: 'rgba(34, 197, 94, 0.1)',
                          borderRadius: '10px',
                          border: '1px solid rgba(34, 197, 94, 0.2)',
                          fontSize: '13px',
                          color: '#22c55e',
                          fontWeight: '500'
                        }}>
                          {extra}
                        </div>
                      )}
                      
                      {/* Weather Sub-Controls - only show for weather setting */}

                    </div>
                  </label>
                </div>
              ))}

            </div>

            {/* Weather Sub-Controls - Separate Section */}
            {settings.showWeather && (
              <div style={{
                background: '#262626',
                borderRadius: '12px',
                border: '1px solid #404040',
                padding: '20px',
                marginTop: '20px',
                transition: 'all 0.2s ease'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px'
                }}>
                  <span style={{ fontSize: '20px' }}>🌤️</span>
                  <div>
                    <h3 style={{ 
                      fontSize: '18px', 
                      fontWeight: '600', 
                      margin: 0,
                      color: '#e2e8f0'
                    }}>
                      Weather Options
                    </h3>
                    <p style={{ 
                      fontSize: '14px', 
                      color: '#94a3b8', 
                      margin: 0 
                    }}>
                      Customize weather display details
                    </p>
                  </div>
                </div>

                {/* Weather Condition Toggle */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px'
                }}>
                  <span style={{ fontSize: '15px', fontWeight: '500', color: '#e2e8f0' }}>Show Weather Condition</span>
                  <div style={{
                    position: 'relative',
                    width: '52px',
                    height: '32px',
                    background: settings.showWeatherCondition 
                      ? 'linear-gradient(45deg, #22c55e, #16a34a)' 
                      : 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '16px',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                    boxShadow: settings.showWeatherCondition 
                      ? '0 4px 12px rgba(34, 197, 94, 0.3)' 
                      : '0 2px 8px rgba(0, 0, 0, 0.1)'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '2px',
                      left: settings.showWeatherCondition ? '22px' : '2px',
                      width: '28px',
                      height: '28px',
                      background: 'white',
                      borderRadius: '50%',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px'
                    }}>
                      {settings.showWeatherCondition ? '✓' : ''}
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showWeatherCondition}
                      onChange={(e) => updateSetting('showWeatherCondition', e.target.checked)}
                      style={{
                        opacity: 0,
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        cursor: 'pointer',
                        margin: 0
                      }}
                    />
                  </div>
                </div>

                {/* Weather Icon Toggle */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px'
                }}>
                  <span style={{ fontSize: '15px', fontWeight: '500', color: '#e2e8f0' }}>Show Weather Icon</span>
                  <div style={{
                    position: 'relative',
                    width: '52px',
                    height: '32px',
                    background: settings.showWeatherIcon 
                      ? 'linear-gradient(45deg, #22c55e, #16a34a)' 
                      : 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '16px',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                    boxShadow: settings.showWeatherIcon 
                      ? '0 4px 12px rgba(34, 197, 94, 0.3)' 
                      : '0 2px 8px rgba(0, 0, 0, 0.1)'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '2px',
                      left: settings.showWeatherIcon ? '22px' : '2px',
                      width: '28px',
                      height: '28px',
                      background: 'white',
                      borderRadius: '50%',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px'
                    }}>
                      {settings.showWeatherIcon ? '✓' : ''}
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showWeatherIcon}
                      onChange={(e) => updateSetting('showWeatherIcon', e.target.checked)}
                      style={{
                        opacity: 0,
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        cursor: 'pointer',
                        margin: 0
                      }}
                    />
                  </div>
                </div>

                {/* Weather Icon Position Dropdown */}
                {settings.showWeatherIcon && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '15px', fontWeight: '500', color: '#e2e8f0' }}>Icon Position</span>
                    <select
                      value={settings.weatherIconPosition}
                      onChange={(e) => updateSetting('weatherIconPosition', e.target.value as 'left' | 'right')}
                      style={{
                        background: '#333',
                        border: '1px solid #555',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        color: '#e2e8f0',
                        fontSize: '14px',
                        cursor: 'pointer',
                        minWidth: '140px'
                      }}
                    >
                      <option value="left" style={{ background: '#1a1a1a', color: '#e2e8f0' }}>Icon on left</option>
                      <option value="right" style={{ background: '#1a1a1a', color: '#e2e8f0' }}>Icon on right</option>
                    </select>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Toast Notification */}
        {showSaveToast && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            fontSize: '14px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'slideInUp 0.3s ease-out',
            transform: showSaveToast ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s ease-out'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              background: saveToastMessage.includes('failed') ? '#ef4444' : '#22c55e',
              borderRadius: '50%',
              flexShrink: 0
            }} />
            {saveToastMessage}
          </div>
        )}

      </div>
    </div>
  );
} 