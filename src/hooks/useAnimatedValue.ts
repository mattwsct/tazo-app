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
  const currentValueRef = useRef<number | null>(displayedValue);

  // Keep ref in sync with displayed value (for use in effect closure)
  useEffect(() => {
    currentValueRef.current = displayedValue;
  }, [displayedValue]);

  useEffect(() => {
    // Handle null values
    if (targetValue === null) {
      if (allowNull) {
        setDisplayedValue(null);
        currentValueRef.current = null;
      }
      return;
    }

    // If no displayed value yet, set it immediately
    if (currentValueRef.current === null && allowNull) {
      setDisplayedValue(targetValue);
      currentValueRef.current = targetValue;
      return;
    }

    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    // Use current displayed value (wherever animation is) as start point
    // This ensures smooth continuation when new value arrives mid-animation
    const startValue = currentValueRef.current ?? 0;
    const difference = targetValue - startValue;

    // If difference is small, update immediately
    if (Math.abs(difference) <= immediateThreshold) {
      setDisplayedValue(targetValue);
      return;
    }

    // Animate the change - duration scales with difference, capped at maxDuration
    const duration = Math.min(Math.abs(difference) * durationMultiplier, maxDuration);
    const startTime = Date.now();
    const precisionMultiplier = Math.pow(10, precision);

    const animate = () => {
      const progress = Math.min((Date.now() - startTime) / duration, 1);
      
      // Linear easing for integers (shows each value), easeOutCubic for decimals
      const easedProgress = precision === 0 
        ? progress 
        : 1 - Math.pow(1 - progress, 3);
      
      const rawValue = startValue + difference * easedProgress;
      const current = precision === 0
        ? Math.round(rawValue)
        : Math.round(rawValue * precisionMultiplier) / precisionMultiplier;

      setDisplayedValue(current);
      currentValueRef.current = current; // Keep ref in sync

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
  }, [targetValue, immediateThreshold, durationMultiplier, maxDuration, precision, allowNull]);

  return displayedValue;
}
