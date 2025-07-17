"use client";

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// === 🗺️ MINIMAP CONFIGURATION ===
const MINIMAP_CONFIG = {
  ZOOM_LEVEL: 13, // Zoomed out for wider area view
  PITCH: 45, // 3D tilt
  BEARING: 0,
  ANIMATION_DURATION: 1000, // ms for smooth transitions
  RECOVERY_DELAY: 2000, // ms to wait before attempting recovery
  MAX_RECOVERY_ATTEMPTS: 3, // Maximum recovery attempts
} as const;

// === 🗺️ MINIMAP LOGGER ===
const MinimapLogger = {
  info: (message: string, data?: unknown) => 
    console.log(`🗺️ [MINIMAP] ${message}`, data || ''),
  error: (message: string, error?: unknown) => 
    console.error(`🗺️ [MINIMAP ERROR] ${message}`, error || ''),
  warn: (message: string, data?: unknown) => 
    console.warn(`🗺️ [MINIMAP WARNING] ${message}`, data || ''),
} as const;

// === 🗺️ MAPBOX MINIMAP COMPONENT ===
interface MapboxMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
  mapboxToken?: string;
}

export default function MapboxMinimap({ lat, lon, isVisible, mapboxToken }: MapboxMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const recoveryAttempts = useRef(0);
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null);
  const isRecovering = useRef(false);
  const [mapStatus, setMapStatus] = useState<'initializing' | 'ready' | 'error' | 'recovering'>('initializing');

  // === 🗺️ WEBGL CONTEXT VALIDATION ===
  const isWebGLSupported = () => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      MinimapLogger.error('WebGL not supported', e);
      return false;
    }
  };

  // === 🗺️ CONSOLE NOISE SUPPRESSION ===
  const suppressConsoleNoise = () => {
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.warn = (...args) => {
      const message = args[0];
      if (typeof message === 'string' && (
        message.includes('WEBGL_debug_renderer_info') ||
        message.includes('Alpha-premult and y-flip') ||
        message.includes('texSubImage') ||
        message.includes('WebGL warning') ||
        message.includes('drawElementsInstanced') ||
        message.includes('Tex image TEXTURE_2D') ||
        message.includes('WebGL context was lost') ||
        message.includes('WebGL: CONTEXT_LOST_WEBGL')
      )) {
        return; // Suppress WebGL warnings
      }
      originalWarn.apply(console, args);
    };
    
    console.error = (...args) => {
      const message = args[0];
      if (typeof message === 'string' && (
        message.includes('Cross-Origin Request Blocked') ||
        message.includes('events.mapbox.com') ||
        message.includes('CORS request did not succeed') ||
        message.includes('featureNamespace') ||
        message.includes('NetworkError when attempting to fetch') ||
        message.includes('WebGL context was lost') ||
        message.includes('WebGL: CONTEXT_LOST_WEBGL')
      )) {
        return; // Suppress CORS and WebGL context errors
      }
      originalError.apply(console, args);
    };

    return { originalWarn, originalError };
  };

  // === 🗺️ MAP CLEANUP ===
  const cleanupMap = () => {
    if (map.current) {
      try {
        MinimapLogger.info('Cleaning up map instance');
        map.current.remove();
      } catch (error) {
        MinimapLogger.error('Error during map cleanup', error);
      }
      map.current = null;
    }
    
    if (recoveryTimeout.current) {
      clearTimeout(recoveryTimeout.current);
      recoveryTimeout.current = null;
    }
    
    isRecovering.current = false;
  };

  // === 🗺️ CREATE MAP INSTANCE ===
  const createMapInstance = () => {
    if (!mapContainer.current || !mapboxToken) {
      return null;
    }

    try {
      // Set the access token before creating the map
      if (mapboxgl.accessToken !== mapboxToken) {
        mapboxgl.accessToken = mapboxToken;
        MinimapLogger.info('Mapbox access token configured');
      }

      // Initialize map with 3D configuration
      const mapInstance = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12', // Streets style supports composite source
        center: [lon, lat],
        zoom: MINIMAP_CONFIG.ZOOM_LEVEL,
        pitch: MINIMAP_CONFIG.PITCH,
        bearing: MINIMAP_CONFIG.BEARING,
        interactive: false, // Disable interaction for overlay
        attributionControl: false,
        logoPosition: 'bottom-left',
        collectResourceTiming: false, // Disable telemetry to reduce CORS errors
        preserveDrawingBuffer: false, // Better performance
        antialias: false, // Reduce WebGL load
        transformRequest: (url) => {
          // Block telemetry requests to reduce console errors
          if (url.includes('events.mapbox.com')) {
            return { url: '' };
          }
          return { url };
        }
      });

      MinimapLogger.info('Mapbox map instance created successfully');

      // Set up error handlers
      mapInstance.on('webglcontextlost', () => {
        MinimapLogger.warn('WebGL context lost - initiating recovery');
        setMapStatus('error');
        // Trigger recovery after a delay
        setTimeout(() => {
          if (isVisible && mapboxToken) {
            cleanupMap();
            recoveryAttempts.current++;
            if (recoveryAttempts.current <= MINIMAP_CONFIG.MAX_RECOVERY_ATTEMPTS) {
              setMapStatus('recovering');
              recoveryTimeout.current = setTimeout(() => {
                const newMap = createMapInstance();
                if (newMap) {
                  map.current = newMap;
                } else {
                  setMapStatus('error');
                  isRecovering.current = false;
                }
              }, MINIMAP_CONFIG.RECOVERY_DELAY);
            }
          }
        }, 1000);
      });

      mapInstance.on('webglcontextrestored', () => {
        MinimapLogger.info('WebGL context restored');
        setMapStatus('ready');
        isRecovering.current = false;
        recoveryAttempts.current = 0;
        
        setTimeout(() => {
          if (mapInstance) {
            mapInstance.resize();
            mapInstance.triggerRepaint();
          }
        }, 100);
      });

      mapInstance.on('error', (e) => {
        MinimapLogger.error('Map error occurred:', e);
        
        // Handle WebGL-related errors
        if (e.error && (
          e.error.message.includes('WebGL') ||
          e.error.message.includes('CONTEXT_LOST') ||
          e.error.message.includes('gl.getError')
        )) {
          setMapStatus('error');
          // Trigger recovery after a delay
          setTimeout(() => {
            if (isVisible && mapboxToken) {
              cleanupMap();
              recoveryAttempts.current++;
              if (recoveryAttempts.current <= MINIMAP_CONFIG.MAX_RECOVERY_ATTEMPTS) {
                setMapStatus('recovering');
                recoveryTimeout.current = setTimeout(() => {
                  const newMap = createMapInstance();
                  if (newMap) {
                    map.current = newMap;
                  } else {
                    setMapStatus('error');
                    isRecovering.current = false;
                  }
                }, MINIMAP_CONFIG.RECOVERY_DELAY);
              }
            }
          }, 1000);
        }
      });

      mapInstance.on('load', () => {
        MinimapLogger.info('Map loaded successfully');
        setMapStatus('ready');
        isRecovering.current = false;
        recoveryAttempts.current = 0;
      });

      // === 🗺️ 3D BUILDINGS & MARKERS ===
      mapInstance.on('style.load', () => {
        if (!mapInstance) return;

        MinimapLogger.info('Map style loaded, adding 3D buildings and marker');

        try {
          // Add 3D buildings layer
          const layers = mapInstance.getStyle().layers;
          
          let firstSymbolId;
          for (const layer of layers) {
            if (layer.type === 'symbol') {
              firstSymbolId = layer.id;
              break;
            }
          }

          mapInstance.addLayer({
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 12, // Show buildings at lower zoom levels
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0, '#666',
                50, '#888',
                100, '#aaa'
              ],
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 0,
                12.5, ['*', ['get', 'height'], 0.8],
                16, ['get', 'height']
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 0,
                12.5, ['*', ['get', 'min_height'], 0.8],
                16, ['get', 'min_height']
              ],
              'fill-extrusion-opacity': 0.9
            }
          }, firstSymbolId);
          
          // Add custom center marker
          const el = document.createElement('div');
          el.style.width = '12px';
          el.style.height = '12px';
          el.style.backgroundColor = '#22c55e';
          el.style.border = '3px solid rgba(255, 255, 255, 0.9)';
          el.style.borderRadius = '50%';
          el.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.8), 0 0 40px rgba(34, 197, 94, 0.4), 0 2px 8px rgba(0, 0, 0, 0.4)';

          new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lon, lat])
            .addTo(mapInstance);
        } catch (error) {
          MinimapLogger.error('Error adding 3D elements', error);
        }
      });

      return mapInstance;
    } catch (error) {
      MinimapLogger.error('Failed to create Mapbox map instance', error);
      return null;
    }
  };

  // === 🗺️ MAIN INITIALIZATION EFFECT ===
  useEffect(() => {
    if (isVisible && mapboxToken) {
      if (!mapContainer.current) {
        MinimapLogger.info('Map initialization skipped - missing container', { 
          hasContainer: !!mapContainer.current, 
        });
        return;
      }

      if (!isWebGLSupported()) {
        MinimapLogger.error('WebGL not supported - minimap cannot be displayed', {
          isWebGLSupported: isWebGLSupported(),
        });
        setMapStatus('error');
        return;
      }

      MinimapLogger.info('Initializing Mapbox minimap', { lat, lon });
      setMapStatus('initializing');
      // Suppress console noise
      const { originalWarn, originalError } = suppressConsoleNoise();

      const newMap = createMapInstance();
      if (newMap) {
        map.current = newMap;
      } else {
        setMapStatus('error');
      }

      // Restore console methods on cleanup
      return () => {
        console.warn = originalWarn;
        console.error = originalError;
        cleanupMap();
      };
    } else {
      cleanupMap();
      setMapStatus('error');
    }
  }, [isVisible, mapboxToken, lat, lon]);

  // === 🗺️ COORDINATE UPDATES ===
  useEffect(() => {
    if (map.current && isVisible && mapStatus === 'ready') {
      MinimapLogger.info('Updating minimap center', { lat, lon });
      try {
        map.current.easeTo({
          center: [lon, lat],
          zoom: MINIMAP_CONFIG.ZOOM_LEVEL,
          duration: MINIMAP_CONFIG.ANIMATION_DURATION
        });
      } catch (error) {
        MinimapLogger.error('Error updating map center', error);
        // Don't trigger recovery for coordinate updates
      }
    }
  }, [lat, lon, isVisible, mapStatus]);

  // === 🗺️ RENDER ===
  if (!isVisible || !mapboxToken) {
    return null;
  }

  return (
    <div 
      ref={mapContainer} 
      style={{ 
        width: '100%', 
        height: '100%', 
        borderRadius: '50%',
        overflow: 'hidden',
        position: 'relative'
      }} 
    >
      {/* Status indicator for debugging */}
      {mapStatus === 'error' && (
        <div style={{
          position: 'absolute',
          top: '5px',
          right: '5px',
          background: 'rgba(239, 64, 64, 0.9)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          zIndex: 1000
        }}>
          WebGL Error
        </div>
      )}
      {mapStatus === 'recovering' && (
        <div style={{
          position: 'absolute',
          top: '5px',
          right: '5px',
          background: 'rgba(245, 158, 11, 0.9)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          zIndex: 1000
        }}>
          Recovering...
        </div>
      )}
    </div>
  );
} 