'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

const CYCLE_DURATION_MS = 30000;
const CROSSFADE_DURATION_MS = 500;

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
}

export default function TopRightRotatingSlot({
  weatherDisplay,
  altitudeDisplay,
  speedDisplay,
  showWeather,
}: TopRightRotatingSlotProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null);
  const transitionRef = useRef<NodeJS.Timeout | null>(null);
  const slidesRef = useRef<SlotType[]>([]);

  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (showWeather && weatherDisplay) s.push('temp');
    if (showWeather && weatherDisplay && (weatherDisplay.icon || weatherDisplay.description)) s.push('condition');
    if (altitudeDisplay) s.push('altitude');
    if (speedDisplay) s.push('speed');
    return s;
  }, [showWeather, weatherDisplay, altitudeDisplay, speedDisplay]);

  const slidesKey = slides.join(',');
  useEffect(() => {
    slidesRef.current = slides;
  }, [slidesKey, slides]);

  useEffect(() => {
    if (slides.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp index when slides change
    setActiveIndex((prev) => Math.min(prev, Math.max(0, slides.length - 1)));
  }, [slides.length, slides]);

  useEffect(() => {
    if (slides.length <= 1) return;

    const tick = () => {
      const current = slidesRef.current;
      if (current.length <= 1) return;

      setActiveIndex((prev) => {
        const idx = Math.min(prev, current.length - 1);
        return (idx + 1) % current.length;
      });
    };

    const id = setInterval(tick, CYCLE_DURATION_MS);
    return () => clearInterval(id);
  }, [slides.length]);

  useEffect(() => {
    if (activeIndex === displayedIndex && outgoingIndex === null) return;
    if (slides.length === 0) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- crossfade transition, timeout handles async
    setOutgoingIndex(displayedIndex);

    if (transitionRef.current) clearTimeout(transitionRef.current);
    transitionRef.current = setTimeout(() => {
      transitionRef.current = null;
      setDisplayedIndex(activeIndex);
      setOutgoingIndex(null);
    }, CROSSFADE_DURATION_MS);

    return () => {
      if (transitionRef.current) clearTimeout(transitionRef.current);
    };
  }, [activeIndex, displayedIndex, outgoingIndex, slides.length]);

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
