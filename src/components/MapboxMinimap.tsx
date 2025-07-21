"use client";

"use client";

import Image from 'next/image';

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

  const size = 200;
  // Request a larger image to ensure copyright is visible but will be cropped by the circle
  const imageSize = Math.ceil(size * 1.2); // 20% larger to ensure copyright is included
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
        transform: "translateZ(0)",
        outline: "none",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
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