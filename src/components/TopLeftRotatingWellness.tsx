'use client';

import { useEffect, useState, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import { TIMERS } from '@/utils/overlay-constants';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

const POLL_INTERVAL_MS = 30000;

type SlotType = 'date' | 'steps' | 'distance';

interface TopLeftRotatingWellnessProps {
  date: string | null;
  timezoneValid: boolean;
  settings: Pick<OverlaySettings, 'showSteps' | 'showDistance'>;
}

interface WellnessData {
  steps?: number;
  distanceKm?: number;
  updatedAt?: number;
}

export default function TopLeftRotatingWellness({ date, timezoneValid, settings }: TopLeftRotatingWellnessProps) {
  const [wellness, setWellness] = useState<WellnessData | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const fetchWellness = async () => {
      try {
        const res = await fetch('/api/wellness');
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (mounted) {
          setWellness({
            steps: typeof data.steps === 'number' ? data.steps : undefined,
            distanceKm: typeof data.distanceKm === 'number' ? data.distanceKm : undefined,
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
          });
          setNow(Date.now());
        }
      } catch {
        // Ignore fetch errors
      }
    };

    fetchWellness();
    const id = setInterval(fetchWellness, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const dataFresh = useMemo(() => {
    if (!wellness?.updatedAt) return false;
    return now - wellness.updatedAt <= TIMERS.WELLNESS_STALE_MS;
  }, [now, wellness?.updatedAt]);

  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (timezoneValid && date) s.push('date');
    if (settings.showSteps !== false && dataFresh && (wellness?.steps ?? 0) > 0) s.push('steps');
    if (settings.showDistance !== false && dataFresh && (wellness?.distanceKm ?? 0) >= 0.1) s.push('distance');
    return s;
  }, [timezoneValid, date, settings.showSteps, settings.showDistance, dataFresh, wellness]);

  const { activeIndex, outgoingIndex } = useCrossfadeRotation(slides, TIMERS.SLOT_CYCLE_DURATION_MS);

  if (slides.length === 0) return null;

  const renderSlot = (type: SlotType) => {
    switch (type) {
      case 'date':
        return (
          <div className="date date-left date-line">
            {date}
          </div>
        );
      case 'steps':
        return (
          <div className="step-counter-wrapper">
            <div className="step-counter-row">
              <span className="step-counter-icon">👟</span>
              <span className="step-counter-value">{(wellness?.steps ?? 0).toLocaleString()}</span>
            </div>
          </div>
        );
      case 'distance': {
        const km = wellness?.distanceKm ?? 0;
        return (
          <div className="step-counter-wrapper">
            <div className="step-counter-row">
              <span className="step-counter-icon">🚶</span>
              <span className="step-counter-value">{km.toFixed(1)} km</span>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="top-left-cycling-wrapper">
      <div className="top-left-cycling-slots">
        {outgoingIndex !== null && slides[outgoingIndex] && (
          <div className="top-left-cycling-slide cycling-slide-out" key={`out-${outgoingIndex}`}>
            {renderSlot(slides[outgoingIndex])}
          </div>
        )}
        <div className="top-left-cycling-slide cycling-slide-in" key={`in-${activeIndex}`}>
          {renderSlot(slides[activeIndex])}
        </div>
      </div>
    </div>
  );
}
