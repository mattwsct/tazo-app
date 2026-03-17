'use client';

import { useEffect, useState } from 'react';
import type { OverlaySettings } from '@/types/settings';

const POLL_INTERVAL_MS = 30000; // 30s — HAE syncs every 15 min; 30s polling means overlay updates within 30s of a sync

interface StepCounterProps {
  settings?: Pick<OverlaySettings, 'showSteps'>;
}

export default function StepCounter({ settings }: StepCounterProps) {
  const [steps, setSteps] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchWellness = async () => {
      try {
        const res = await fetch('/api/wellness');
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (mounted && typeof data.stepsSinceStreamStart === 'number') {
          setSteps(data.stepsSinceStreamStart);
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
  const hasSteps = showStepsSetting && steps !== null && steps >= 0;
  if (!hasSteps) return null;

  return (
    <div className="step-counter-wrapper">
      <div className="step-counter-row">
        <span className="step-counter-icon">👟</span>
        <span className="step-counter-value">{steps!.toLocaleString()}</span>
        <span className="step-counter-label">steps</span>
      </div>
    </div>
  );
}
