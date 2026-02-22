'use client';

import { useEffect, useState, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import { TIMERS } from '@/utils/overlay-constants';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';

const POLL_INTERVAL_MS = 60000;
const CYCLE_DURATION_MS = 30000;

type SlotType = 'date' | 'steps';

interface TopLeftRotatingWellnessProps {
  date: string | null;
  timezoneValid: boolean;
  settings: Pick<OverlaySettings, 'showSteps'>;
}

interface WellnessData {
  stepsSinceStreamStart?: number;
  updatedAt?: number;
}

export default function TopLeftRotatingWellness({ date, timezoneValid, settings }: TopLeftRotatingWellnessProps) {
  const [wellness, setWellness] = useState<WellnessData | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchWellness = async () => {
      try {
        const res = await fetch('/api/wellness');
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (mounted) {
          setWellness({
            stepsSinceStreamStart: typeof data.stepsSinceStreamStart === 'number' ? data.stepsSinceStreamStart : undefined,
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
          });
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

  const stepsFresh = useMemo(() => {
    if (!wellness?.updatedAt) return false;
    return Date.now() - wellness.updatedAt <= TIMERS.WELLNESS_STALE_MS;
  }, [wellness?.updatedAt]);

  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (timezoneValid && date) s.push('date');
    if (settings.showSteps !== false && stepsFresh && wellness?.stepsSinceStreamStart != null && wellness.stepsSinceStreamStart >= 0) s.push('steps');
    return s;
  }, [timezoneValid, date, settings.showSteps, stepsFresh, wellness]);

  const { activeIndex, outgoingIndex } = useCrossfadeRotation(slides, CYCLE_DURATION_MS);

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
              <span className="step-counter-value">{wellness!.stepsSinceStreamStart!.toLocaleString()}</span>
              <span className="step-counter-label">steps</span>
            </div>
          </div>
        );
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
