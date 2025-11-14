"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/client-auth';
import { OverlaySettings, DEFAULT_OVERLAY_SETTINGS, LocationDisplayMode, MapZoomLevel } from '@/types/settings';
import { formatLocation, LocationData } from '@/utils/location-utils';
import { fetchLocationFromLocationIQ } from '@/utils/api-utils';
import { API_KEYS, type RTIRLPayload } from '@/utils/overlay-constants';
import '@/styles/admin.css';

declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

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

  // Real location data for examples
  const [currentLocationData, setCurrentLocationData] = useState<LocationData | null>(null);
  const [locationExamplesLoading, setLocationExamplesLoading] = useState(false);
  
  // Force refresh location examples
  const refreshLocationExamples = useCallback(async () => {
    if (!API_KEYS.RTIRL || !window.RealtimeIRL) return;
    
    setLocationExamplesLoading(true);
    try {
      // Get current location from RTIRL
      const payload = await new Promise<RTIRLPayload>((resolve) => {
        window.RealtimeIRL!.forPullKey(API_KEYS.RTIRL!).addListener((p: unknown) => {
          resolve(p as RTIRLPayload);
        });
      });
      
      if (payload?.location) {
        let lat: number | null = null;
        let lon: number | null = null;
        
        if ('lat' in payload.location && 'lon' in payload.location) {
          lat = payload.location.lat;
          lon = payload.location.lon;
        } else if ('latitude' in payload.location && 'longitude' in payload.location) {
          const loc = payload.location as { latitude: number; longitude: number };
          lat = loc.latitude;
          lon = loc.longitude;
        }
        
        if (lat !== null && lon !== null && API_KEYS.LOCATIONIQ) {
          const locationResult = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
          if (locationResult && locationResult.location) {
            setCurrentLocationData(locationResult.location);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to refresh location examples:', error);
    } finally {
      setLocationExamplesLoading(false);
    }
  }, []);

  // Generate location examples using the same logic as overlay
  const getLocationExample = useCallback((mode: LocationDisplayMode): string | undefined => {
    // Don't show examples for custom and hidden modes
    if (mode === 'custom' || mode === 'hidden') {
      return undefined;
    }
    
    if (locationExamplesLoading) {
      return 'Loading...';
    }
    
    if (!currentLocationData) {
      // Fallback examples when RTIRL is not available
      const fallbackExamples: Record<LocationDisplayMode, string> = {
        neighborhood: 'Burleigh Heads, Australia',
        city: 'Gold Coast, Australia',
        country: 'Texas, USA',
        custom: '',
        hidden: ''
      };
      return fallbackExamples[mode];
    }
    
    // Use the same formatLocation function as the overlay
    const formatted = formatLocation(currentLocationData, mode);
    
    // For country-only mode, just return the country (no primary location)
    if (mode === 'country') {
      return formatted.country || '';
    }
    
    // For other modes, combine primary and country
    if (formatted.primary && formatted.country) {
      return `${formatted.primary}, ${formatted.country}`;
    }
    return formatted.primary || formatted.country || '';
  }, [currentLocationData, locationExamplesLoading]);
  

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
    
    // Auto-set zoom level based on location display mode
    if (updates.locationDisplay !== undefined) {
      if (updates.locationDisplay === 'neighborhood') {
        mergedSettings.mapZoomLevel = 'neighborhood'; // More zoomed in for neighborhoods
      } else if (updates.locationDisplay === 'country') {
        mergedSettings.mapZoomLevel = 'national'; // National view for country-only mode
      } else {
        mergedSettings.mapZoomLevel = 'city'; // City level for other locations
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

  // Fetch location data once on load for examples
  useEffect(() => {
    let hasFetched = false;
    
    const fetchLocationOnce = () => {
      if (hasFetched) return;
      
      if (typeof window !== 'undefined' && window.RealtimeIRL && API_KEYS.RTIRL) {
        hasFetched = true;
        setLocationExamplesLoading(true);
        
        // Set up a one-time listener to get current location
        window.RealtimeIRL.forPullKey(API_KEYS.RTIRL).addListener((p: unknown) => {
          try {
            if (!p || typeof p !== 'object') {
              return;
            }
            const payload = p as RTIRLPayload;
            
            // Extract GPS coordinates
            let lat: number | null = null;
            let lon: number | null = null;
            if (payload.location) {
              if ('lat' in payload.location && 'lon' in payload.location) {
                lat = payload.location.lat;
                lon = payload.location.lon;
              } else if ('latitude' in payload.location && 'longitude' in payload.location) {
                const loc = payload.location as { latitude: number; longitude: number };
                lat = loc.latitude;
                lon = loc.longitude;
              }
            }
            
            if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
              // Fetch location data once for examples
              (async () => {
                try {
                  if (API_KEYS.LOCATIONIQ) {
                    const locationResult = await fetchLocationFromLocationIQ(lat, lon, API_KEYS.LOCATIONIQ);
                    if (locationResult && locationResult.location) {
                      setCurrentLocationData(locationResult.location);
                      setLocationExamplesLoading(false);
                    }
                  }
                } catch (error) {
                  console.warn('Failed to fetch location for examples:', error);
                  setLocationExamplesLoading(false);
                }
              })();
              
              // Remove listener after first successful fetch
              // Note: RTIRL doesn't provide a remove method, but we set hasFetched to prevent further processing
            }
          } catch (error) {
            console.warn('RTIRL listener error:', error);
            setLocationExamplesLoading(false);
          }
        });
      }
    };
    
    // Check if RTIRL is already loaded
    if (typeof window !== 'undefined' && window.RealtimeIRL) {
      fetchLocationOnce();
    } else {
      // Load RTIRL script if not already loaded
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@rtirl/api@latest/lib/index.min.js';
      script.async = true;
      script.onerror = () => {
        console.warn('Failed to load RTIRL script for examples');
        setLocationExamplesLoading(false);
      };
      script.onload = () => {
        fetchLocationOnce();
      };
      document.body.appendChild(script);
    }
  }, []);

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

      {/* Main Content */}
      <main className="main-content">
        <div className="settings-container">
          
          {/* Location & Display Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>📍 Location & Display</h2>
              <p className="section-description">Configure how your location appears on the overlay</p>
            </div>
            
            <div className="setting-group">
              <div className="group-label-with-action">
                <label className="group-label">Location Mode</label>
                <button 
                  onClick={refreshLocationExamples}
                  disabled={locationExamplesLoading}
                  className="refresh-button-compact"
                  title="Refresh location examples"
                >
                  {locationExamplesLoading ? '🔄' : '🔄'}
                </button>
              </div>
              <RadioGroup
                value={settings.locationDisplay}
                onChange={(value) => handleSettingsChange({ locationDisplay: value as LocationDisplayMode })}
                options={[
                  { 
                    value: 'neighborhood', 
                    label: 'Neighborhood', 
                    icon: '🏘️',
                    description: getLocationExample('neighborhood')
                  },
                  { 
                    value: 'city', 
                    label: 'City', 
                    icon: '🏙️',
                    description: getLocationExample('city')
                  },
                  { 
                    value: 'country', 
                    label: 'Country Only', 
                    icon: '🌍',
                    description: getLocationExample('country')
                  },
                  { 
                    value: 'custom', 
                    label: 'Custom', 
                    icon: '✏️',
                    description: getLocationExample('custom')
                  },
                  { 
                    value: 'hidden', 
                    label: 'Hidden', 
                    icon: '🚫',
                    description: getLocationExample('hidden')
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
                  <div className="input-help">
                    This will override GPS-based location detection. Saves automatically after 1 second of no typing.
                  </div>
                  
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
              
              <div className="setting-help">
                {locationExamplesLoading && (
                  <div className="location-examples-loading">
                    🔄 Loading current location...
                  </div>
                )}
                {currentLocationData && !locationExamplesLoading && (
                  <div className="location-examples-real">
                    ✅ Showing your current location
                  </div>
                )}
                {!currentLocationData && !locationExamplesLoading && (
                  <div className="location-examples-fallback">
                    ℹ️ Showing sample data (RTIRL not connected)
                  </div>
                )}
                {settings.locationDisplay === 'neighborhood' && 'Shows most specific location (neighborhood/area) with country'}
                {settings.locationDisplay === 'city' && 'Shows city level location with country'}
                {settings.locationDisplay === 'country' && 'Shows only country name with flag (may include state/territory)'}
                {settings.locationDisplay === 'custom' && 'Displays custom text instead of GPS-based location'}
                {settings.locationDisplay === 'hidden' && 'Hides location display completely'}
              </div>
            </div>
          </section>

          {/* Weather Section */}
          {settings.locationDisplay !== 'hidden' && (
            <section className="settings-section">
              <div className="section-header">
                <h2>🌤️ Weather</h2>
                <p className="section-description">Display real-time weather information</p>
              </div>
              
              <div className="setting-group">
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.showWeather}
                      onChange={(e) => handleSettingsChange({ showWeather: e.target.checked })}
                      className="checkbox-input"
                    />
                    <span className="checkbox-text">Show Temperature & Conditions</span>
                  </label>
                </div>
                <div className="setting-help">
                  Updates every 5 minutes with current temperature and weather icon
                </div>
              </div>
            </section>
          )}

          {/* Map Section */}
          <section className="settings-section">
            <div className="section-header">
              <h2>🗺️ Map</h2>
              <p className="section-description">Configure the minimap display</p>
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
              
              <div className="setting-help">
                Auto on Movement shows minimap only when moving (speed &gt; 10 km/h)
              </div>
            </div>
            
            <div className="setting-group">
              <label className="group-label">Zoom Level</label>
              <select
                value={settings.mapZoomLevel}
                onChange={(e) => handleSettingsChange({ mapZoomLevel: e.target.value as MapZoomLevel })}
                className="select-input"
              >
                <option value="neighborhood">Neighborhood (13) - Streets & Buildings</option>
                <option value="city">City (11) - Whole City View</option>
                <option value="regional">Regional (8) - State/Province View</option>
                <option value="national">National (5) - Country View</option>
                <option value="ocean">Ocean (3) - Coastal View from Sea</option>
                <option value="continental">Continental (1) - Trans-Oceanic View</option>
              </select>
              <div className="setting-help">
                Higher numbers = more zoomed in. Ocean is for cruises near coast, Continental for mid-ocean.
              </div>
            </div>
          </section>
          
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