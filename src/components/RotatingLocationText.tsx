'use client';

import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

const CYCLE_DURATION_MS = 8000;

interface RotatingLocationTextProps {
  levels: string[];
}

export default function RotatingLocationText({ levels }: RotatingLocationTextProps) {
  const { activeIndex, outgoingIndex } = useCrossfadeRotation(levels, CYCLE_DURATION_MS);

  if (levels.length === 0) return null;

  return (
    <div className="location-rotating-wrapper">
      <div className="location-rotating-slots">
        {outgoingIndex !== null && levels[outgoingIndex] && (
          <div className="location-rotating-slide cycling-slide-out" key={`out-${outgoingIndex}`}>
            <span className="location-main">{levels[outgoingIndex]}</span>
          </div>
        )}
        <div className="location-rotating-slide cycling-slide-in" key={`in-${activeIndex}`}>
          <span className="location-main">{levels[activeIndex]}</span>
        </div>
      </div>
    </div>
  );
}
