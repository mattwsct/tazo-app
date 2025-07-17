"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LeafletMinimapProps {
  lat: number;
  lon: number;
  isVisible: boolean;
}

const MINIMAP_CONFIG = {
  ZOOM_LEVEL: 13,
  MARKER_SIZE: 8,
  MARKER_COLOR: "#10b981",
  MARKER_GLOW: "#10b98140",
};

export default function LeafletMinimap({ lat, lon, isVisible }: LeafletMinimapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);

  // Helper to create a custom marker
  function createCustomMarker() {
    const markerHtml = `
      <div style="
        width: ${MINIMAP_CONFIG.MARKER_SIZE}px;
        height: ${MINIMAP_CONFIG.MARKER_SIZE}px;
        background: ${MINIMAP_CONFIG.MARKER_COLOR};
        border-radius: 50%;
        box-shadow: 0 0 20px 8px ${MINIMAP_CONFIG.MARKER_GLOW};
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      "></div>
    `;
    return L.divIcon({
      html: markerHtml,
      className: "custom-leaflet-marker",
      iconSize: [0, 0], // Set to 0 to let the HTML element control positioning
      iconAnchor: [0, 0], // Set to 0 to let CSS handle centering
    });
  }

  // Initialize map
  useEffect(() => {
    if (!isVisible || !mapContainer.current) return;
    if (map.current) return; // Prevent double init

    map.current = L.map(mapContainer.current, {
      center: [lat, lon],
      zoom: MINIMAP_CONFIG.ZOOM_LEVEL,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    // Use CartoDB Positron tiles for clean, colorful maps with English names
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© CartoDB",
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map.current);

    marker.current = L.marker([lat, lon], {
      icon: createCustomMarker(),
      interactive: false,
      keyboard: false,
      title: "",
    }).addTo(map.current);

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
    // eslint-disable-next-line
  }, [isVisible]);

  // Update marker and center
  useEffect(() => {
    if (map.current && marker.current && isVisible) {
      marker.current.setLatLng([lat, lon]);
      map.current.setView([lat, lon], MINIMAP_CONFIG.ZOOM_LEVEL, { animate: true });
    }
  }, [lat, lon, isVisible]);

  if (!isVisible) return null;

  return (
    <div
      ref={mapContainer}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        overflow: "hidden",
        position: "relative",
        background: "#f8fafc",
        border: "2px solid #e2e8f0",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
      }}
    />
  );
} 