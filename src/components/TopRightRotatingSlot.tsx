'use client';

import { useMemo } from 'react';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

const CYCLE_DURATION_MS = 30000;

type SlotType = 'temp' | 'condition' | 'altitude' | 'speed';

interface WeatherDisplay {
  temperature: string;
  icon?: string | null;
  description?: string | null;
}

interface TopRightRotatingSlotProps {
  weatherDisplay: WeatherDisplay | null;
  altitudeDisplay: { formatted: string } | null;
  speedDisplay: { formatted: string } | null;
  showWeather: boolean;
  showAltitude?: boolean;
  showSpeed?: boolean;
}

export default function TopRightRotatingSlot({
  weatherDisplay,
  altitudeDisplay,
  speedDisplay,
  showWeather,
  showAltitude = true,
  showSpeed = true,
}: TopRightRotatingSlotProps) {
  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (showWeather && weatherDisplay) s.push('temp');
    if (showWeather && weatherDisplay && (weatherDisplay.icon || weatherDisplay.description)) s.push('condition');
    if (showAltitude && altitudeDisplay) s.push('altitude');
    if (showSpeed && speedDisplay) s.push('speed');
    return s;
  }, [showWeather, weatherDisplay, showAltitude, altitudeDisplay, showSpeed, speedDisplay]);

  const { activeIndex, outgoingIndex } = useCrossfadeRotation(slides, CYCLE_DURATION_MS);

  if (slides.length === 0) return null;

  const renderSlot = (type: SlotType) => {
    switch (type) {
      case 'temp':
        return (
          <div className="weather weather-line">
            <div className="weather-text-group">
              <div className="weather-temperature">{weatherDisplay!.temperature}</div>
            </div>
          </div>
        );
      case 'condition':
        return (
          <div className="weather weather-line">
            <div className="weather-condition-group">
              {weatherDisplay!.description && (
                <span className="weather-description-text">{weatherDisplay!.description}</span>
              )}
              {weatherDisplay!.icon && (
                <span className="weather-icon-inline">{weatherDisplay!.icon}</span>
              )}
            </div>
          </div>
        );
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
