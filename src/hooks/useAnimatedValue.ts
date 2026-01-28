import { useState, useEffect, useRef } from 'react';

interface UseAnimatedValueOptions {
  /** Threshold below which changes update immediately without animation */
  immediateThreshold?: number;
  /** Duration multiplier (duration = abs(difference) * multiplier) */
  durationMultiplier?: number;
  /** Maximum animation duration in milliseconds */
  maxDuration?: number;
  /** Precision for rounding (number of decimal places, or 0 for integers) */
  precision?: number;
  /** Whether to allow null values */
  allowNull?: boolean;
}

/**
 * Custom hook for animating numeric values with easing
 * @param targetValue The target value to animate to
 * @param options Configuration options
 * @returns The current animated value
 */
export function useAnimatedValue(
  targetValue: number | null,
  options: UseAnimatedValueOptions = {}
): number | null {
  const {
    immediateThreshold = 0.5,
    durationMultiplier = 30,
    maxDuration = 800,
    precision = 1,
    allowNull = false,
  } = options;

  const [displayedValue, setDisplayedValue] = useState<number | null>(
    allowNull ? null : (targetValue ?? 0)
  );
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    // Handle null values
    if (targetValue === null) {
      if (allowNull) {
        setDisplayedValue(null);
      }
      return;
    }

    // If no displayed value yet, set it immediately
    if (displayedValue === null && allowNull) {
      setDisplayedValue(targetValue);
      return;
    }

    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startValue = displayedValue ?? 0;
    const endValue = targetValue;
    const difference = endValue - startValue;

    // If difference is small, update immediately
    if (Math.abs(difference) <= immediateThreshold) {
      setDisplayedValue(endValue);
      return;
    }

    // Animate the change
    // Duration scales linearly with difference, capped at maxDuration
    // This provides consistent feel: small changes animate quickly, large changes use max duration
    const duration = Math.min(Math.abs(difference) * durationMultiplier, maxDuration);
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Use easeOutCubic for smoother, more natural feeling animations
      // Starts fast, slows down smoothly at the end
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      let current: number;
      if (precision === 0) {
        current = Math.round(startValue + difference * easeOutCubic);
      } else {
        const multiplier = Math.pow(10, precision);
        current = Math.round((startValue + difference * easeOutCubic) * multiplier) / multiplier;
      }

      setDisplayedValue(current);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetValue, displayedValue, immediateThreshold, durationMultiplier, maxDuration, precision, allowNull]);

  return displayedValue;
}
