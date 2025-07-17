"use client";

interface MapboxMinimapProps {
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

export default function MapboxMinimap({ lat, lon, isVisible }: MapboxMinimapProps) {
  if (!isVisible) return null;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) return null;

  const size = 300; // Larger image to crop out copyright
  const url = `/api/static-map?lat=${lat}&lon=${lon}&zoom=${MINIMAP_CONFIG.ZOOM_LEVEL}&size=${size}`;

  return (
    <div
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
    >
      <img
        src={url}
        alt="Map preview"
        style={{
          width: "150%", // Larger than container to crop out edges
          height: "150%", // Larger than container to crop out edges
          borderRadius: "50%",
          objectFit: "cover",
          opacity: 0.95,
          position: "absolute",
          top: "-25%", // Center the larger image
          left: "-25%", // Center the larger image
        }}
        draggable={false}
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
          boxShadow: `0 0 20px ${MINIMAP_CONFIG.MARKER_GLOW}, 0 0 40px ${MINIMAP_CONFIG.MARKER_GLOW}, 0 0 60px ${MINIMAP_CONFIG.MARKER_GLOW}, 0 2px 8px rgba(0,0,0,0.4)`,
          zIndex: 2,
        }}
      />
      

    </div>
  );
} 