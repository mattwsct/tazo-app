"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapLibreMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
}

const MINIMAP_CONFIG = {
  ZOOM_LEVEL: 13,
  MARKER_SIZE: 12,
  MARKER_COLOR: "#22c55e",
  MARKER_GLOW: "#22c55e80",
} as const;

// Available map styles - easily switch between them
const MAP_STYLES = {
  // OpenStreetMap (current default)
  osm: {
    version: 8 as const,
    sources: {
      'raster-tiles': {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] as string[],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [{
      id: 'simple-tiles',
      type: 'raster' as const,
      source: 'raster-tiles',
      minzoom: 0,
      maxzoom: 19
    }]
  },
  
  // CartoDB Positron (light, clean style)
  positron: {
    version: 8 as const,
    sources: {
      'carto-tiles': {
        type: 'raster' as const,
        tiles: [
          'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
          'https://cartodb-basemaps-b.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
          'https://cartodb-basemaps-c.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png'
        ] as string[],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CartoDB'
      }
    },
    layers: [{
      id: 'carto-tiles',
      type: 'raster' as const,
      source: 'carto-tiles',
      minzoom: 0,
      maxzoom: 19
    }]
  },
  
  // CartoDB Dark Matter (dark style)
  dark: {
    version: 8 as const,
    sources: {
      'carto-dark-tiles': {
        type: 'raster' as const,
        tiles: [
          'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
          'https://cartodb-basemaps-b.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
          'https://cartodb-basemaps-c.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'
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
  },
  
  // Stamen Toner (high contrast, black and white)
  toner: {
    version: 8 as const,
    sources: {
      'stamen-tiles': {
        type: 'raster' as const,
        tiles: ['https://stamen-tiles.a.ssl.fastly.net/toner/{z}/{x}/{y}.png'] as string[],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © Stamen Design'
      }
    },
    layers: [{
      id: 'stamen-tiles',
      type: 'raster' as const,
      source: 'stamen-tiles',
      minzoom: 0,
      maxzoom: 19
    }]
  }
};

// Change this to switch map styles easily
const CURRENT_STYLE = 'positron'; // Options: 'osm', 'positron', 'dark', 'toner'

export default function MapLibreMinimap({ lat, lon, isVisible }: MapLibreMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Add marker function
  const addMarker = useCallback(() => {
    if (!map.current) return;
    
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
    .addTo(map.current);
  }, [lon, lat]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current || !isVisible) return;

    // Check WebGL support
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('WebGL not supported, falling back to error state');
      setMapError(true);
      return;
    }
    
    try {
      // Use selected map style
      const mapStyle = MAP_STYLES[CURRENT_STYLE];

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: mapStyle,
        center: [lon, lat],
        zoom: MINIMAP_CONFIG.ZOOM_LEVEL,
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
  }, [isVisible, lat, lon, addMarker]);

  // Update map center and marker position
  useEffect(() => {
    if (!map.current || !marker.current || !mapLoaded) return;

    try {
      // Update map center
      map.current.setCenter([lon, lat]);
      
      // Update marker position
      marker.current.setLngLat([lon, lat]);
    } catch (error) {
      console.error('Failed to update map position:', error);
    }
  }, [lat, lon, mapLoaded]);

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
