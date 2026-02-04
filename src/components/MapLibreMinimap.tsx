"use client";

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapZoomLevel } from '@/types/settings';

interface MapLibreMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
  zoomLevel: MapZoomLevel;
  isNight?: boolean; // Pass day/night state from parent
}


const MINIMAP_CONFIG = {
  ZOOM_LEVELS: {
    neighbourhood: 13,  // Neighbourhood - streets & buildings
    city: 11,          // City - whole city view
    state: 8,          // State - state/province view
    country: 5,       // Country - country view
    ocean: 3,          // Ocean - coastal view from sea
    continental: 1     // Continental - trans-oceanic, see entire ocean
  },
  MARKER_SIZE: 12,
  MARKER_COLOR: "#22c55e",
  MARKER_GLOW: "#22c55e80",
} as const;


// Map style URLs - using MapTiler Streets-v2 styles (light and dark)
// MapTiler provides excellent English label support and beautiful map styles
// Streets-v2 is the classic default style with full labels and place names
// Requires a free API key from https://cloud.maptiler.com/account/keys/
// Falls back to OpenFreeMap if no API key is provided
import { API_KEYS } from '@/utils/overlay-constants';

const MAPTILER_KEY = API_KEYS.MAPTILER;

// MapTiler Streets-v2 styles (light and dark variants)
const MAPTILER_STYLES = {
  light: MAPTILER_KEY 
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
    : null,
  dark: MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`
    : null,
} as const;

// Fallback to OpenFreeMap if MapTiler key not available
const FALLBACK_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/positron'
} as const;

const MAP_STYLE_URLS = {
  light: MAPTILER_STYLES.light || FALLBACK_STYLES.light,
  dark: MAPTILER_STYLES.dark || FALLBACK_STYLES.dark,
} as const;

export default function MapLibreMinimap({ lat, lon, isVisible, zoomLevel, isNight = false }: MapLibreMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);


  // Initialize map (only once when first visible)
  useEffect(() => {
    if (!mapContainer.current || map.current || !isVisible) return;
    
    // Reset position tracking when map is initialized
    prevPosition.current = null;
    lastUpdateTime.current = 0;

    // Check WebGL support
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('WebGL not supported, falling back to error state');
      setMapError(true);
      return;
    }
    
    try {
      // Use the isNight prop passed from parent (based on OpenWeatherMap data)
      const styleURL = isNight ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light;

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: styleURL,
        center: [lon, lat],
        zoom: MINIMAP_CONFIG.ZOOM_LEVELS[zoomLevel] || MINIMAP_CONFIG.ZOOM_LEVELS.city,
        interactive: false, // Disable user interaction for overlay
        attributionControl: false,
        logoPosition: 'bottom-right'
      });

      // Add error handling
      map.current.on('error', (e) => {
        console.error('MapLibre error:', e);
        setMapError(true);
      });

      // Add load event
      map.current.on('load', () => {
        setMapLoaded(true);
        
        // Set English labels for fallback styles (MapTiler handles this automatically)
        // Only needed for OpenFreeMap fallback
        if (!MAPTILER_KEY) {
          try {
            const style = map.current!.getStyle();
            if (style?.layers) {
              style.layers.forEach((layer) => {
                if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
                  const textField = layer.layout['text-field'];
                  if (textField && typeof textField === 'object' && Array.isArray(textField)) {
                    if (textField[0] === 'get' && textField[1] !== 'name:en') {
                      map.current!.setLayoutProperty(layer.id, 'text-field', [
                        'coalesce',
                        ['get', 'name:en'],
                        ['get', 'name']
                      ]);
                    }
                  } else if (typeof textField === 'string' && !textField.includes('name:en')) {
                    map.current!.setLayoutProperty(layer.id, 'text-field', [
                      'coalesce',
                      ['get', 'name:en'],
                      ['get', 'name']
                    ]);
                  }
                }
              });
            }
          } catch (error) {
            console.warn('Failed to set English labels:', error);
          }
        }
        
        // Add marker
        const markerElement = document.createElement('div');
        markerElement.style.width = `${MINIMAP_CONFIG.MARKER_SIZE}px`;
        markerElement.style.height = `${MINIMAP_CONFIG.MARKER_SIZE}px`;
        markerElement.style.borderRadius = '50%';
        markerElement.style.backgroundColor = MINIMAP_CONFIG.MARKER_COLOR;
        markerElement.style.boxShadow = `0 0 8px ${MINIMAP_CONFIG.MARKER_GLOW}, 0 2px 4px rgba(0,0,0,0.3)`;
        markerElement.style.border = '2px solid white';
        markerElement.style.zIndex = '2';

        marker.current = new maplibregl.Marker({
          element: markerElement,
          anchor: 'center'
        })
        .setLngLat([lon, lat])
        .addTo(map.current!);
      });

    } catch (error) {
      console.error('Failed to initialize MapLibre:', error);
      setMapError(true);
    }

    // Cleanup
    return () => {
      if (marker.current) {
        marker.current.remove();
        marker.current = null;
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]); // Only depend on isVisible - lat/lon/zoom intentionally omitted to prevent re-initialization

  // Track previous position to calculate movement distance
  const prevPosition = useRef<[number, number] | null>(null);
  const lastUpdateTime = useRef(0);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update map center and marker position efficiently
  useEffect(() => {
    if (!map.current || !marker.current || !mapLoaded) return;

    // Throttle updates to prevent excessive map operations (max once per 500ms)
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime.current;
    const THROTTLE_MS = 500; // Minimum time between map updates

    // Clear any pending update
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    const MIN_PAN_DISTANCE = 100; // meters - threshold for animation duration
    const shouldUpdateNow = timeSinceLastUpdate >= THROTTLE_MS;

    const updateMap = () => {
      try {
        // Calculate movement distance for animation duration
        let movementDistance = Infinity;
        if (prevPosition.current) {
          const [prevLon, prevLat] = prevPosition.current;
          const R = 6371000; // Earth radius in meters
          const dLat = (lat - prevLat) * Math.PI / 180;
          const dLon = (lon - prevLon) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          movementDistance = R * c;
        }

        // Pan map to keep marker centered
        // Use shorter animation for small movements to reduce visual impact
        const animationDuration = movementDistance > MIN_PAN_DISTANCE ? 800 : 300;
        
        map.current!.easeTo({
          center: [lon, lat],
          duration: animationDuration,
          easing: (t) => t * (2 - t) // ease-out function
        });
        
        marker.current!.setLngLat([lon, lat]);
        
        // Update previous position and timestamp
        prevPosition.current = [lon, lat];
        lastUpdateTime.current = Date.now();
      } catch (error) {
        console.error('Failed to update map position:', error);
      }
    };

    if (shouldUpdateNow) {
      // Update immediately if enough time has passed
      updateMap();
    } else {
      // Schedule update after throttle period
      updateTimeoutRef.current = setTimeout(updateMap, THROTTLE_MS - timeSinceLastUpdate);
    }

    // Cleanup timeout on unmount
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    };
  }, [lat, lon, mapLoaded]);

  // Update zoom level when zoom level setting changes (with smooth animation)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      const newZoom = MINIMAP_CONFIG.ZOOM_LEVELS[zoomLevel] || MINIMAP_CONFIG.ZOOM_LEVELS.city;
      map.current.easeTo({
        zoom: newZoom,
        duration: 800, // 0.8 second smooth zoom transition
        easing: (t) => t * (2 - t) // ease-out function
      });
    } catch (error) {
      console.error('Failed to update map zoom:', error);
    }
  }, [zoomLevel, mapLoaded]);

  // Update map style when isNight prop changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const newStyleURL = isNight ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light;
    try {
      map.current.setStyle(newStyleURL);
      
      // Set English labels for fallback styles (MapTiler handles this automatically)
      if (!MAPTILER_KEY) {
        map.current.once('style.load', () => {
          try {
            const style = map.current!.getStyle();
            if (style?.layers) {
              style.layers.forEach((layer) => {
                if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
                  const textField = layer.layout['text-field'];
                  if (textField && typeof textField === 'object' && Array.isArray(textField)) {
                    if (textField[0] === 'get' && textField[1] !== 'name:en') {
                      map.current!.setLayoutProperty(layer.id, 'text-field', [
                        'coalesce',
                        ['get', 'name:en'],
                        ['get', 'name']
                      ]);
                    }
                  } else if (typeof textField === 'string' && !textField.includes('name:en')) {
                    map.current!.setLayoutProperty(layer.id, 'text-field', [
                      'coalesce',
                      ['get', 'name:en'],
                      ['get', 'name']
                    ]);
                  }
                }
              });
            }
          } catch (error) {
            console.warn('Failed to set English labels after style change:', error);
          }
        });
      }
    } catch (error) {
      console.error('Failed to update map style:', error);
    }
  }, [isNight, mapLoaded]);

  if (!isVisible) return null;

  if (mapError) {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          borderRadius: "50%",
          overflow: "hidden",
          position: "relative",
          background: "#f8fafc",
          border: "2px solid rgba(255, 255, 255, 0.9)",
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️</div>
          <div style={{ fontSize: '0.875rem' }}>Map unavailable</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapContainer}
      style={{
        width: "200px",
        height: "200px",
        borderRadius: "50%",
        overflow: "hidden",
        position: "relative",
        background: "#f8fafc",
        border: "2px solid rgba(255, 255, 255, 0.9)",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
        transform: "translateZ(0)",
        outline: "none",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}
    />
  );
}
