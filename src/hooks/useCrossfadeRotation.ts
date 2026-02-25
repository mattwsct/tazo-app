'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

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
  const slideCount = slides.length;

  // Stabilise slides ref — only update when content actually changes
  const prevSlidesKeyRef = useRef(slidesKey);
  useEffect(() => {
    if (prevSlidesKeyRef.current !== slidesKey) {
      prevSlidesKeyRef.current = slidesKey;
    }
    slidesRef.current = slides;
  }, [slidesKey, slides]);

  // Clamp activeIndex when the number of slides shrinks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (slideCount === 0) return;
    setActiveIndex((prev) => Math.min(prev, Math.max(0, slideCount - 1)));
  }, [slideCount]);

  // Rotation timer — only restart when slide count or cycle duration changes
  useEffect(() => {
    if (slideCount <= 1) return;

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
  }, [slideCount, cycleDurationMs]);

  // Crossfade transition — only trigger on activeIndex changes from the
  // rotation timer, not from slide-content updates that don't affect indices.
  useEffect(() => {
    if (activeIndex === displayedIndex && outgoingIndex === null) return;
    if (slideCount === 0) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  // Return a stable slides reference — only changes when content changes
  // so downstream components don't re-render on every GPS tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSlides = useMemo(() => slides, [slidesKey]);

  return { activeIndex, displayedIndex, outgoingIndex, slides: stableSlides };
}
