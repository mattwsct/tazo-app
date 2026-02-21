'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Number input that validates/clamps only on blur.
 * Fixes UX where typing e.g. "120" would immediately clamp: "1"→5, "2"→52, "0"→300.
 * User can type freely; value is clamped when they leave the field.
 */
export function ClampedNumberInput({
  value,
  onChange,
  min,
  max,
  defaultWhenInvalid,
  onBlur,
  presets,
  className,
  style,
  ...props
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  defaultWhenInvalid?: number;
  onBlur?: (value: number) => void | Promise<void>;
  presets?: number[];
  className?: string;
  style?: React.CSSProperties;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const fallback = defaultWhenInvalid ?? min;
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused && String(value) !== localValue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled input when value prop changes externally
      setLocalValue(String(value));
    }
  }, [value, isFocused, localValue]);

  const commitValue = useCallback(
    (raw: string): number => {
      const parsed = parseInt(raw, 10);
      const valid = !Number.isNaN(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
      onChange(valid);
      setLocalValue(String(valid));
      return valid;
    },
    [onChange, min, max, fallback]
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const committed = commitValue(localValue);
    onBlur?.(committed);
  }, [localValue, commitValue, onBlur]);

  const handleFocus = useCallback(() => setIsFocused(true), []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v === '' || /^-?\d*$/.test(v)) setLocalValue(v);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      }
    },
    []
  );

  return (
    <span className="clamped-number-input-wrap">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={localValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        className={className}
        style={style}
        {...props}
      />
      {presets && presets.length > 0 && (
        <span className="clamped-number-presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className="clamped-number-preset-btn"
              onClick={() => {
                onChange(p);
                setLocalValue(String(p));
              }}
            >
              {p}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
