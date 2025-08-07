"use client";

import { useState, useRef } from 'react';

interface MapboxMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
  speedKmh?: number; // Optional speed for smart coordinate rounding
}

const MINIMAP_CONFIG = {
  ZOOM_LEVEL: 13,
  MARKER_SIZE: 12,
  MARKER_COLOR: "#22c55e",
  MARKER_GLOW: "#22c55e80",
} as const;

export default function MapboxMinimap({ lat, lon, isVisible, speedKmh = 0 }: MapboxMinimapProps) {
  const [imageError, setImageError] = useState(false);
  const lastUpdateRef = useRef(0);
  
  // Prevent excessive API calls with minimum update interval
  const now = Date.now();
  const minUpdateInterval = speedKmh > 50 ? 5000 : 2000; // 5s for high speed, 2s for low speed
  const shouldUpdate = (now - lastUpdateRef.current) >= minUpdateInterval;
  
  if (!isVisible) return null;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) return null;

  const size = 200;
  // Request a larger image to ensure copyright is visible but will be cropped by the circle
  const imageSize = Math.ceil(size * 1.2); // 20% larger to ensure copyright is included
  
  // Smart coordinate rounding based on speed to balance update frequency with API limits
  // At higher speeds, use less precision to reduce API calls
  // At lower speeds, use more precision for better tracking
  let precision: number;
  if (speedKmh > 80) {
    precision = 2; // ~1km precision for highway speeds
  } else if (speedKmh > 30) {
    precision = 3; // ~100m precision for city driving
  } else {
    precision = 4; // ~10m precision for slow movement
  }
  
  const roundedLat = parseFloat(lat.toFixed(precision));
  const roundedLon = parseFloat(lon.toFixed(precision));
  
  // Debug logging for coordinate precision (only in development and occasionally)
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.05) { // 5% chance to log
    console.log('🗺️ Minimap coordinate precision:', {
      original: { lat: lat.toFixed(6), lon: lon.toFixed(6) },
      rounded: { lat: roundedLat, lon: roundedLon },
      precision,
      speedKmh: Math.round(speedKmh),
      distance: Math.sqrt(Math.pow(lat - roundedLat, 2) + Math.pow(lon - roundedLon, 2)) * 111000 // Approximate meters
    });
  }
  
  const url = `/api/static-map?lat=${roundedLat}&lon=${roundedLon}&zoom=${MINIMAP_CONFIG.ZOOM_LEVEL}&size=${imageSize}`;
  
  // Update timestamp if we're going to make an API call
  if (shouldUpdate) {
    lastUpdateRef.current = now;
  }

  if (imageError) {
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <img
        src={url}
        alt="Map preview"
        width={imageSize}
        height={imageSize}
        style={{
          width: `${imageSize}px`,
          height: `${imageSize}px`,
          objectFit: "cover",
          opacity: 0.95,
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)", // Center the larger image
        }}
        draggable={false}
        onError={(e) => {
          console.error('Map image error:', e);
          setImageError(true);
        }}
      />
      {/* Center green dot with simplified glow for OBS compatibility */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: MINIMAP_CONFIG.MARKER_SIZE,
          height: MINIMAP_CONFIG.MARKER_SIZE,
          background: MINIMAP_CONFIG.MARKER_COLOR,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          boxShadow: `0 0 8px ${MINIMAP_CONFIG.MARKER_GLOW}, 0 2px 4px rgba(0,0,0,0.3)`,
          zIndex: 2,
        }}
      />
    </div>
  );
} 