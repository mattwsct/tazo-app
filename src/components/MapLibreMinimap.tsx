"use client";

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TIMERS } from '@/utils/overlay-constants';
import { OverlayLogger } from '@/lib/logger';

interface MapLibreMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
  speedKmh?: number;
}

const MINIMAP_CONFIG = {
  ZOOM_LEVEL: 13,
  MARKER_SIZE: 12,
  MARKER_COLOR: "#22c55e",
  MARKER_GLOW: "#22c55e80",
} as const;

export default function MapLibreMinimap({ lat, lon, isVisible, speedKmh = 0 }: MapLibreMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mapError, setMapError] = useState(false);
  const lastUpdateRef = useRef(0);
  const lastCoordsRef = useRef<[number, number]>([0, 0]);

  // Prevent excessive updates with minimum update interval by speed bucket
  const now = Date.now();
  const minUpdateInterval =
    speedKmh > 50 ? TIMERS.MAP_MIN_INTERVAL_FAST :
    speedKmh > 10 ? TIMERS.MAP_MIN_INTERVAL_MED :
    TIMERS.MAP_MIN_INTERVAL_SLOW;

  const timeOk = (now - lastUpdateRef.current) >= minUpdateInterval;

  // Smart coordinate rounding based on speed to balance update frequency with performance
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

  // Check if coordinates have changed significantly
  const coordsChanged = 
    Math.abs(roundedLat - lastCoordsRef.current[0]) > 0.0001 ||
    Math.abs(roundedLon - lastCoordsRef.current[1]) > 0.0001;

  const shouldUpdate = timeOk && coordsChanged;

  useEffect(() => {
    if (!isVisible || !mapContainer.current) {
      OverlayLogger.overlay('MapLibre minimap: not visible or no container', { isVisible, hasContainer: !!mapContainer.current });
      return;
    }

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      OverlayLogger.warn('Mapbox token not available for minimap');
      setMapError(true);
      return;
    }

    OverlayLogger.overlay('MapLibre minimap: initializing', { lat, lon, isVisible });

    try {
      // Check if MapLibre GL JS is available
      if (typeof maplibregl === 'undefined') {
        throw new Error('MapLibre GL JS not loaded');
      }

      // Check container dimensions
      if (!mapContainer.current || mapContainer.current.offsetWidth === 0 || mapContainer.current.offsetHeight === 0) {
        OverlayLogger.warn('MapLibre minimap: container has no dimensions', {
          hasContainer: !!mapContainer.current,
          width: mapContainer.current?.offsetWidth,
          height: mapContainer.current?.offsetHeight
        });
      }

      OverlayLogger.overlay('MapLibre minimap: creating map instance', { 
        container: mapContainer.current?.id || 'no-id',
        hasContainer: !!mapContainer.current,
        style: `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${mapboxToken.substring(0, 8)}...`,
        containerDimensions: {
          width: mapContainer.current?.offsetWidth,
          height: mapContainer.current?.offsetHeight
        }
      });

      // Initialize MapLibre GL JS map with Mapbox Streets v12 style
      // Use initial coordinates for map center
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${mapboxToken}`,
        center: [lon, lat], // Use props directly, not rounded values
        zoom: MINIMAP_CONFIG.ZOOM_LEVEL,
        interactive: false, // Disable interaction for overlay
        attributionControl: false,
        // Performance optimizations
        renderWorldCopies: false,
        maxZoom: 18,
        minZoom: 1,
      });

      // Add error handling
      map.current.on('error', (e) => {
        // Log raw error object for debugging
        console.log('Raw MapLibre error object:', e);
        console.log('Error keys:', Object.keys(e || {}));
        console.log('Error constructor:', e?.constructor?.name);
        console.log('Error prototype:', Object.getPrototypeOf(e));
        console.log('Error enumerable properties:', Object.getOwnPropertyNames(e || {}));
        
        // Cast to access MapLibre specific properties
        const errorObj = e as unknown as Record<string, unknown>;
        
        // Extract the actual error from the error property
        const actualError = errorObj?.error as Error | undefined;
        
        // Log the actual error for debugging
        console.log('Actual error object:', actualError);
        console.log('Actual error message:', actualError?.message);
        console.log('Actual error name:', actualError?.name);
        console.log('Actual error stack:', actualError?.stack);
        
        // Extract error details safely
        const errorDetails = {
          message: actualError?.message || e?.message || 'Unknown error',
          type: e?.type || 'Unknown type',
          target: e?.target ? '[DOM Element]' : 'No target',
          errorCode: errorObj?.errorCode || 'No error code',
          status: errorObj?.status || 'No status',
          url: errorObj?.url || 'No URL',
          // Try to extract more properties safely
          name: actualError?.name || errorObj?.name || 'No name',
          stack: actualError?.stack || errorObj?.stack || 'No stack',
          // MapLibre specific properties
          style: errorObj?.style ? 'Style object present' : 'No style',
          // Simple string representation
          toString: actualError?.toString?.() || e?.toString?.() || 'No toString method',
          // Raw error object properties
          rawErrorType: actualError?.constructor?.name || 'Unknown',
          rawErrorMessage: actualError?.message || 'No raw error message'
        };
        
        OverlayLogger.error('MapLibre GL JS error:', errorDetails);
        setMapError(true);
      });

      map.current.on('loaderror', (e) => {
        // Cast to access MapLibre specific properties
        const errorObj = e as unknown as Record<string, unknown>;
        
        // Extract error details safely
        const errorDetails = {
          message: e?.message || 'Unknown load error',
          type: e?.type || 'Unknown type',
          target: e?.target ? '[DOM Element]' : 'No target',
          errorCode: errorObj?.errorCode || 'No error code',
          status: errorObj?.status || 'No status',
          url: errorObj?.url || 'No URL',
          // Try to extract more properties safely
          name: errorObj?.name || 'No name',
          stack: errorObj?.stack || 'No stack',
          // Simple string representation
          toString: e?.toString?.() || 'No toString method'
        };
        
        OverlayLogger.error('MapLibre GL JS load error:', errorDetails);
        setMapError(true);
      });

      // Add style loading event
      map.current.on('style.load', () => {
        OverlayLogger.overlay('MapLibre style loaded successfully');
      });

      // Add load event
      map.current.on('load', () => {
        OverlayLogger.overlay('MapLibre minimap loaded successfully');
        
        // Create marker with initial coordinates
        marker.current = new maplibregl.Marker({
          color: MINIMAP_CONFIG.MARKER_COLOR,
          scale: 1.2,
        })
          .setLngLat([lon, lat]) // Use props directly
          .addTo(map.current!);

        // Add marker glow effect using a custom marker
        const markerElement = marker.current.getElement();
        if (markerElement) {
          markerElement.style.filter = `drop-shadow(0 0 8px ${MINIMAP_CONFIG.MARKER_GLOW}) drop-shadow(0 2px 4px rgba(0,0,0,0.3))`;
        }
      });

      // Store initial coordinates
      lastCoordsRef.current = [lat, lon];
      lastUpdateRef.current = Date.now();

    } catch (error) {
      const err = error as Error;
      OverlayLogger.error('Failed to initialize MapLibre minimap:', {
        error: error,
        message: err?.message || 'Unknown initialization error',
        stack: err?.stack || 'No stack trace',
        name: err?.name || 'Unknown error type'
      });
      setMapError(true);
    }

    // Cleanup function
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
  }, [isVisible, lat, lon]); // Include lat/lon for initial setup only

  // Update map position when coordinates change
  useEffect(() => {
    if (!map.current || !marker.current || !shouldUpdate) return;

    const currentTime = Date.now();
    const currentLat = roundedLat;
    const currentLon = roundedLon;

    try {
      // Update map center
      map.current.setCenter([currentLon, currentLat]);
      
      // Update marker position
      marker.current.setLngLat([currentLon, currentLat]);

      // Update stored coordinates and timestamp
      lastCoordsRef.current = [currentLat, currentLon];
      lastUpdateRef.current = currentTime;

      OverlayLogger.overlay('Minimap updated', { 
        lat: currentLat, 
        lon: currentLon, 
        speed: speedKmh 
      });

    } catch (error) {
      OverlayLogger.error('Failed to update minimap position:', error);
    }
  }, [roundedLat, roundedLon, shouldUpdate, speedKmh]);

  if (!isVisible) return null;

  if (mapError) {
    // Fallback to static map if WebGL fails
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (mapboxToken) {
      const imageSize = 240; // 20% larger for better quality
      const url = `/api/static-map?lat=${lat}&lon=${lon}&zoom=${MINIMAP_CONFIG.ZOOM_LEVEL}&size=${imageSize}`;
      
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
          <img
            src={url}
            alt="Map preview (fallback)"
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
              transform: "translate(-50%, -50%)",
            }}
            draggable={false}
            onError={() => {
              OverlayLogger.error('Static map fallback also failed');
            }}
          />
          {/* Center green dot with glow */}
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
    
    // Final fallback if no Mapbox token
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
      }}
    >
      <div
        ref={mapContainer}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
