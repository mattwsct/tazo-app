'use client';

import { useState, useEffect, useRef } from 'react';

const CROSSFADE_DURATION_MS = 500;

interface CrossfadeState<T> {
  activeIndex: number;
  displayedIndex: number;
  outgoingIndex: number | null;
  slides: T[];
}

export function useCrossfadeRotation<T>(slides: T[], cycleDurationMs: number): CrossfadeState<T> {
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null);
  const transitionRef = useRef<NodeJS.Timeout | null>(null);
  const slidesRef = useRef<T[]>([]);

  const slidesKey = slides.join(',');
  useEffect(() => {
    slidesRef.current = slides;
  }, [slidesKey, slides]);

  useEffect(() => {
    if (slides.length === 0) return;
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

    // Align ticks to wall clock so all rotations with the same (or multiple)
    // cycle duration change at the same moment regardless of mount time.
    const now = Date.now();
    const msUntilNextTick = cycleDurationMs - (now % cycleDurationMs);

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const initialTimeout = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, cycleDurationMs);
    }, msUntilNextTick);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [slides.length, cycleDurationMs]);

  useEffect(() => {
    if (activeIndex === displayedIndex && outgoingIndex === null) return;
    if (slides.length === 0) return;

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

  return { activeIndex, displayedIndex, outgoingIndex, slides };
}
