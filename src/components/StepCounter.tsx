'use client';

import { useEffect, useState } from 'react';
import { kmToMiles } from '@/utils/unit-conversions';

const POLL_INTERVAL_MS = 10000; // 10s — wellness data updates from Health Auto Export

export default function StepCounter() {
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

  const hasSteps = steps !== null && steps >= 0;
  const hasDistance = distance !== null && distance > 0;
  if (!hasSteps && !hasDistance) return null;

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
          <span className="step-counter-value">
            {distance! >= 1 ? distance!.toFixed(1) : distance!.toFixed(2)} km ({kmToMiles(distance!).toFixed(1)} mi)
          </span>
        </div>
      )}
    </div>
  );
}
