// === 📊 PERFORMANCE MONITORING ===

import React from 'react';

/**
 * Hook to monitor component render performance
 * Warns if component re-renders too frequently
 */
export function useRenderPerformance(componentName: string) {
  const renderCount = React.useRef(0);
  const lastRenderTime = React.useRef(0); // Initialized in effect to avoid calling performance.now() during render

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    renderCount.current++;
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTime.current;
    lastRenderTime.current = now;

    if (renderCount.current > 10 && timeSinceLastRender < 100) {
      console.warn(`Frequent re-renders detected: ${componentName} rendered ${renderCount.current} times`);
    }
  }, [componentName]);
} 