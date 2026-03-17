'use client';

import { TIMERS } from '@/utils/overlay-constants';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

interface RotatingLocationTextProps {
  levels: string[];
}

export default function RotatingLocationText({ levels }: RotatingLocationTextProps) {
  const { activeIndex, outgoingIndex } = useCrossfadeRotation(levels, TIMERS.SLOT_CYCLE_DURATION_MS);

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
