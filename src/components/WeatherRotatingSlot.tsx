'use client';

import { useMemo } from 'react';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

// Synced with goals rotation and other overlay elements
const WEATHER_CYCLE_MS = 10_000;

type WeatherSlide = 'temperature' | 'condition';

interface WeatherCondition {
  label: string;
  icon: string;
}

interface WeatherRotatingSlotProps {
  temperature: string;
  condition: WeatherCondition | null;
}

export default function WeatherRotatingSlot({ temperature, condition }: WeatherRotatingSlotProps) {
  const slides = useMemo<WeatherSlide[]>(() => {
    if (!condition) return ['temperature'];
    return ['temperature', 'condition'];
  }, [condition]);

  const { activeIndex, outgoingIndex } = useCrossfadeRotation(slides, WEATHER_CYCLE_MS);

  const renderSlide = (type: WeatherSlide) => {
    switch (type) {
      case 'temperature':
        return <div className="weather-temperature">{temperature}</div>;
      case 'condition':
        return (
          <div className="weather-condition-group">
            <span className="weather-description-text">{condition!.label}</span>
            <span className="weather-icon-inline">{condition!.icon}</span>
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
            {renderSlide(slides[outgoingIndex])}
          </div>
        )}
        <div className="top-right-cycling-slide cycling-slide-in" key={`in-${activeIndex}`}>
          {renderSlide(slides[activeIndex])}
        </div>
      </div>
    </div>
  );
}
