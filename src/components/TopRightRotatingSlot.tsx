'use client';

import { useMemo } from 'react';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

const CYCLE_DURATION_MS = 8000;

type SlotType = 'altitude' | 'speed';

interface TopRightRotatingSlotProps {
  altitudeDisplay: { formatted: string } | null;
  speedDisplay: { formatted: string } | null;
  showAltitude?: boolean;
  showSpeed?: boolean;
}

export default function TopRightRotatingSlot({
  altitudeDisplay,
  speedDisplay,
  showAltitude = true,
  showSpeed = true,
}: TopRightRotatingSlotProps) {
  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (showAltitude && altitudeDisplay) s.push('altitude');
    if (showSpeed && speedDisplay) s.push('speed');
    return s;
  }, [showAltitude, altitudeDisplay, showSpeed, speedDisplay]);

  const { activeIndex, outgoingIndex } = useCrossfadeRotation(slides, CYCLE_DURATION_MS);

  if (slides.length === 0) return null;

  const renderSlot = (type: SlotType) => {
    switch (type) {
      case 'altitude':
        return (
          <div className="weather weather-line movement-data-line">
            <div className="weather-temperature">{altitudeDisplay!.formatted}</div>
          </div>
        );
      case 'speed':
        return (
          <div className="weather weather-line movement-data-line">
            <div className="weather-temperature">{speedDisplay!.formatted}</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="top-right-cycling-wrapper">
      <div className="top-right-cycling-slots">
        {outgoingIndex !== null && slides[outgoingIndex] && (
          <div className="top-right-cycling-slide cycling-slide-out" key={`out-${outgoingIndex}`}>
            {renderSlot(slides[outgoingIndex])}
          </div>
        )}
        <div className="top-right-cycling-slide cycling-slide-in" key={`in-${activeIndex}`}>
          {renderSlot(slides[activeIndex])}
        </div>
      </div>
    </div>
  );
}
