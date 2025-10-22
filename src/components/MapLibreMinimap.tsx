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
}

// Calculate sunrise and sunset times based on lat/lon
// Using simplified algorithm (accurate to ~2 minutes)
function getSunTimes(lat: number, lon: number): { sunrise: Date; sunset: Date } {
  const now = new Date();
  
  // Get day of year
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  
  // Calculate solar noon
  const lngHour = lon / 15;
  const t = dayOfYear + ((12 - lngHour) / 24);
  
  // Sun's mean anomaly
  const M = (0.9856 * t) - 3.289;
  
  // Sun's true longitude
  const L = M + (1.916 * Math.sin(M * Math.PI / 180)) + (0.020 * Math.sin(2 * M * Math.PI / 180)) + 282.634;
  const Lnorm = ((L % 360) + 360) % 360;
  
  // Sun's right ascension
  let RA = Math.atan(0.91764 * Math.tan(Lnorm * Math.PI / 180)) * 180 / Math.PI;
  RA = ((RA % 360) + 360) % 360;
  
  // Right ascension needs to be in same quadrant as L
  const Lquadrant = (Math.floor(Lnorm / 90)) * 90;
  const RAquadrant = (Math.floor(RA / 90)) * 90;
  RA = RA + (Lquadrant - RAquadrant);
  RA = RA / 15;
  
  // Sun's declination
  const sinDec = 0.39782 * Math.sin(Lnorm * Math.PI / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  
  // Sun's local hour angle
  const cosH = (Math.cos(90.833 * Math.PI / 180) - (sinDec * Math.sin(lat * Math.PI / 180))) / (cosDec * Math.cos(lat * Math.PI / 180));
  
  // Check if sun never rises or sets
  if (cosH > 1) {
    // Sun never rises - always night
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return { sunrise: midnight, sunset: midnight };
  }
  if (cosH < -1) {
    // Sun never sets - always day
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    return { sunrise: noon, sunset: noon };
  }
  
  const H = Math.acos(cosH) * 180 / Math.PI;
  
  // Calculate sunrise and sunset
  const sunrise = ((360 - H) / 15) + RA - (0.06571 * t) - 6.622 - lngHour;
  const sunset = (H / 15) + RA - (0.06571 * t) - 6.622 - lngHour;
  
  // Normalize to 0-24 range
  const sunriseNorm = ((sunrise % 24) + 24) % 24;
  const sunsetNorm = ((sunset % 24) + 24) % 24;
  
  // Create Date objects for today's sunrise and sunset
  const sunriseDate = new Date(now);
  sunriseDate.setHours(Math.floor(sunriseNorm), Math.floor((sunriseNorm % 1) * 60), 0, 0);
  
  const sunsetDate = new Date(now);
  sunsetDate.setHours(Math.floor(sunsetNorm), Math.floor((sunsetNorm % 1) * 60), 0, 0);
  
  return { sunrise: sunriseDate, sunset: sunsetDate };
}

// Helper function to determine if it's night time based on actual sunrise/sunset
function isNightTime(lat: number, lon: number, timezone?: string): boolean {
  try {
    const { sunrise, sunset } = getSunTimes(lat, lon);
    const now = new Date();
    
    // If we have timezone info, get current time in that timezone
    let currentTime = now;
    if (timezone) {
      const timeStr = now.toLocaleString('en-US', { timeZone: timezone });
      currentTime = new Date(timeStr);
    }
    
    // Night is before sunrise or after sunset
    return currentTime < sunrise || currentTime > sunset;
  } catch (error) {
    console.error('Failed to determine night time:', error);
    return false;
  }
}

const MINIMAP_CONFIG = {
  ZOOM_LEVELS: {
    street: 13,   // Street level - can see individual streets
    city: 11,     // City level - can see city boundaries
    region: 8,    // State/region level - can see state boundaries
    country: 5    // Country level - can see country boundaries
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

export default function MapLibreMinimap({ lat, lon, isVisible, zoomLevel, timezone }: MapLibreMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isDark, setIsDark] = useState(false);


  // Initialize map (only once when first visible)
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
      // Determine if it's night time based on actual sunrise/sunset
      const isNight = isNightTime(lat, lon, timezone);
      setIsDark(isNight);
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

  // Update map center and marker position smoothly
  useEffect(() => {
    if (!map.current || !marker.current || !mapLoaded) return;

    try {
      // Smoothly pan to new center with animation
      map.current.easeTo({
        center: [lon, lat],
        duration: 1000, // 1 second smooth transition
        easing: (t) => t * (2 - t) // ease-out function
      });
      
      // Update marker position (marker will move with the map)
      marker.current.setLngLat([lon, lat]);
    } catch (error) {
      console.error('Failed to update map position:', error);
    }
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

  // Check for day/night changes every minute and update map style if needed
  useEffect(() => {
    if (!map.current || !mapLoaded || !timezone) return;

    const checkDayNight = () => {
      const isNight = isNightTime(lat, lon, timezone);
      if (isNight !== isDark) {
        setIsDark(isNight);
        const newStyle = isNight ? MAP_STYLES.dark : MAP_STYLES.voyager;
        try {
          map.current?.setStyle(newStyle);
        } catch (error) {
          console.error('Failed to update map style:', error);
        }
      }
    };

    // Check immediately
    checkDayNight();

    // Then check every minute
    const interval = setInterval(checkDayNight, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, mapLoaded, isDark]); // lat/lon intentionally omitted - checkDayNight closure captures current values

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
