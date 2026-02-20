'use client';

import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 10000; // 10s — wellness data updates from Health Auto Export

export default function StepCounter() {
  const [steps, setSteps] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchSteps = async () => {
      try {
        const res = await fetch('/api/wellness');
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (typeof data.stepsSinceStreamStart === 'number' && mounted) {
          setSteps(data.stepsSinceStreamStart);
        }
      } catch {
        // Ignore fetch errors
      }
    };

    fetchSteps();
    const id = setInterval(fetchSteps, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  if (steps === null || steps < 0) return null;

  return (
    <div className="step-counter-wrapper">
      <span className="step-counter-icon">👟</span>
      <span className="step-counter-value">{steps.toLocaleString()}</span>
      <span className="step-counter-label">steps</span>
    </div>
  );
}
