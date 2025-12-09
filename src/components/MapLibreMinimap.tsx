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
  timezone?: string;
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


// Available map styles - easily switch between them
const MAP_STYLES = {
  // CartoDB Voyager (clean, colorful, perfect for daytime)
  voyager: {
    version: 8 as const,
    sources: {
      'carto-voyager-tiles': {
        type: 'raster' as const,
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
        ] as string[],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CartoDB'
      }
    },
    layers: [{
      id: 'carto-voyager-tiles',
      type: 'raster' as const,
      source: 'carto-voyager-tiles',
      minzoom: 0,
      maxzoom: 19
    }]
  },
  // CartoDB Dark Matter (clean, dark, perfect for nighttime)
  dark: {
    version: 8 as const,
    sources: {
      'carto-dark-tiles': {
        type: 'raster' as const,
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
        ] as string[],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CartoDB'
      }
    },
    layers: [{
      id: 'carto-dark-tiles',
      type: 'raster' as const,
      source: 'carto-dark-tiles',
      minzoom: 0,
      maxzoom: 19
    }]
  }
};

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
      const mapStyle = isNight ? MAP_STYLES.dark : MAP_STYLES.voyager;

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: mapStyle,
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

    // Calculate movement distance if we have a previous position
    // Calculate movement distance if previous position exists
    // Note: Movement distance calculation is available for future pan threshold logic
    if (prevPosition.current) {
      const [prevLon, prevLat] = prevPosition.current;
      // Simple distance calculation (Haversine approximation)
      const R = 6371000; // Earth radius in meters
      const dLat = (lat - prevLat) * Math.PI / 180;
      const dLon = (lon - prevLon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      // Movement distance calculated but not currently used
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _movementDistance = R * c;
    }

    const MIN_PAN_DISTANCE = 100; // Only pan map if movement > 100m
    const shouldUpdateNow = timeSinceLastUpdate >= THROTTLE_MS;

    const updateMap = () => {
      try {
        // Recalculate movement distance at update time (in case position changed)
        let currentMovementDistance = Infinity;
        if (prevPosition.current) {
          const [prevLon, prevLat] = prevPosition.current;
          const R = 6371000; // Earth radius in meters
          const dLat = (lat - prevLat) * Math.PI / 180;
          const dLon = (lon - prevLon) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          currentMovementDistance = R * c;
        }

        // Always pan map to keep marker centered at [lon, lat]
        // Marker stays fixed in center, only map moves
        // For small movements, use shorter/faster animation to reduce visual impact
        const animationDuration = currentMovementDistance > MIN_PAN_DISTANCE ? 800 : 300;
        
        map.current!.easeTo({
          center: [lon, lat], // Pan map to keep marker centered
          duration: animationDuration,
          easing: (t) => t * (2 - t) // ease-out function
        });
        
        // Marker position matches map center, so it stays centered
        // We still update it to ensure it's at the exact coordinates
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

    const newStyle = isNight ? MAP_STYLES.dark : MAP_STYLES.voyager;
    try {
      map.current.setStyle(newStyle);
      console.log(`🗺️ Map style updated to ${isNight ? 'dark' : 'light'} mode`);
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
