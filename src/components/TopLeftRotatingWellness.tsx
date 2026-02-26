'use client';

import { useEffect, useState, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import { TIMERS } from '@/utils/overlay-constants';
import { useCrossfadeRotation } from '@/hooks/useCrossfadeRotation';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';

const POLL_INTERVAL_MS = 60000;
const CYCLE_DURATION_MS = 16000;

type SlotType = 'date' | 'steps' | 'distance' | 'activeCalories' | 'flights';

interface TopLeftRotatingWellnessProps {
  date: string | null;
  timezoneValid: boolean;
  settings: Pick<OverlaySettings, 'showSteps' | 'showDistance' | 'showActiveCalories' | 'showFlights'>;
}

interface WellnessData {
  stepsSinceStreamStart?: number;
  distanceSinceStreamStart?: number;
  activeCaloriesSinceStreamStart?: number;
  flightsSinceStreamStart?: number;
  updatedAt?: number;
  lastSessionUpdateAt?: number;
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
            stepsSinceStreamStart: typeof data.stepsSinceStreamStart === 'number' ? data.stepsSinceStreamStart : undefined,
            distanceSinceStreamStart: typeof data.distanceSinceStreamStart === 'number' ? data.distanceSinceStreamStart : undefined,
            activeCaloriesSinceStreamStart: typeof data.activeCaloriesSinceStreamStart === 'number' ? data.activeCaloriesSinceStreamStart : undefined,
            flightsSinceStreamStart: typeof data.flightsSinceStreamStart === 'number' ? data.flightsSinceStreamStart : undefined,
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
            lastSessionUpdateAt: typeof data.lastSessionUpdateAt === 'number' ? data.lastSessionUpdateAt : undefined,
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

  const stepsFresh = useMemo(() => {
    const latest = Math.max(wellness?.updatedAt ?? 0, wellness?.lastSessionUpdateAt ?? 0);
    if (!latest) return false;
    return now - latest <= TIMERS.WELLNESS_STALE_MS;
  }, [now, wellness?.updatedAt, wellness?.lastSessionUpdateAt]);

  const slides = useMemo<SlotType[]>(() => {
    const s: SlotType[] = [];
    if (timezoneValid && date) s.push('date');
    if (settings.showSteps !== false && stepsFresh && wellness?.stepsSinceStreamStart != null && wellness.stepsSinceStreamStart > 0) s.push('steps');
    if (settings.showDistance !== false && stepsFresh && wellness?.distanceSinceStreamStart != null && wellness.distanceSinceStreamStart >= 0.1) s.push('distance');
    if (settings.showActiveCalories !== false && stepsFresh && wellness?.activeCaloriesSinceStreamStart != null && wellness.activeCaloriesSinceStreamStart > 0) s.push('activeCalories');
    if (settings.showFlights !== false && stepsFresh && wellness?.flightsSinceStreamStart != null && wellness.flightsSinceStreamStart >= 1) s.push('flights');
    return s;
  }, [timezoneValid, date, settings.showSteps, settings.showDistance, settings.showActiveCalories, settings.showFlights, stepsFresh, wellness]);

  const animatedSteps = useAnimatedValue(
    wellness?.stepsSinceStreamStart ?? null,
    { precision: 0, durationMultiplier: 5, maxDuration: 1500, immediateThreshold: 1, allowNull: true }
  );

  const animatedDistanceKm = useAnimatedValue(
    wellness?.distanceSinceStreamStart ?? null,
    { precision: 1, durationMultiplier: 3000, maxDuration: 1000, immediateThreshold: 0.05, allowNull: true }
  );

  const animatedActiveCalories = useAnimatedValue(
    wellness?.activeCaloriesSinceStreamStart ?? null,
    { precision: 0, durationMultiplier: 5, maxDuration: 1500, immediateThreshold: 1, allowNull: true }
  );

  const animatedFlights = useAnimatedValue(
    wellness?.flightsSinceStreamStart ?? null,
    { precision: 0, durationMultiplier: 5, maxDuration: 1500, immediateThreshold: 1, allowNull: true }
  );

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
              <span className="step-counter-value">{(animatedSteps ?? 0).toLocaleString()}</span>
            </div>
          </div>
        );
      case 'distance': {
        const km = animatedDistanceKm ?? 0;
        return (
          <div className="step-counter-wrapper">
            <div className="step-counter-row">
              <span className="step-counter-icon">🚶</span>
              <span className="step-counter-value">{km.toFixed(1)} km</span>
            </div>
          </div>
        );
      }
      case 'activeCalories':
        return (
          <div className="step-counter-wrapper">
            <div className="step-counter-row">
              <span className="step-counter-icon">🔥</span>
              <span className="step-counter-value">{(animatedActiveCalories ?? 0).toLocaleString()} cal</span>
            </div>
          </div>
        );
      case 'flights':
        return (
          <div className="step-counter-wrapper">
            <div className="step-counter-row">
              <span className="step-counter-icon">🪜</span>
              <span className="step-counter-value">{(animatedFlights ?? 0).toLocaleString()} flights</span>
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
