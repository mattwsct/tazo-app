'use client';

import { useEffect, useState } from 'react';
import { kmToMiles } from '@/utils/unit-conversions';
import type { OverlaySettings } from '@/types/settings';

const POLL_INTERVAL_MS = 10000; // 10s — wellness data updates from Health Auto Export

interface StepCounterProps {
  settings?: Pick<OverlaySettings, 'showSteps' | 'showDistance' | 'showDistanceMiles'>;
}

export default function StepCounter({ settings }: StepCounterProps) {
  const [steps, setSteps] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchWellness = async () => {
      try {
        const res = await fetch('/api/wellness');
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (mounted) {
          if (typeof data.stepsSinceStreamStart === 'number') {
            setSteps(data.stepsSinceStreamStart);
          }
          if (typeof data.distanceSinceStreamStart === 'number') {
            setDistance(data.distanceSinceStreamStart);
          }
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

  const showStepsSetting = settings?.showSteps ?? true;
  const showDistanceSetting = settings?.showDistance ?? true;
  const showMiles = settings?.showDistanceMiles ?? true;

  const hasSteps = showStepsSetting && steps !== null && steps >= 0;
  const hasDistance = showDistanceSetting && distance !== null && distance > 0;
  if (!hasSteps && !hasDistance) return null;

  const distanceFormatted = hasDistance
    ? showMiles
      ? `${distance! >= 1 ? distance!.toFixed(1) : distance!.toFixed(2)} km (${kmToMiles(distance!).toFixed(1)} mi)`
      : `${distance! >= 1 ? distance!.toFixed(1) : distance!.toFixed(2)} km`
    : '';

  return (
    <div className="step-counter-wrapper">
      {hasSteps && (
        <div className="step-counter-row">
          <span className="step-counter-icon">👟</span>
          <span className="step-counter-value">{steps!.toLocaleString()}</span>
          <span className="step-counter-label">steps</span>
        </div>
      )}
      {hasDistance && (
        <div className="step-counter-row">
          <span className="step-counter-icon">🚶</span>
          <span className="step-counter-value">{distanceFormatted}</span>
        </div>
      )}
    </div>
  );
}
