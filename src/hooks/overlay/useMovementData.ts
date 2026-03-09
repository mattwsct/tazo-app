"use client";

import { useState, useRef } from 'react';

/**
 * Manages GPS movement state: speed, altitude, map coordinates, and the refs
 * used by the RTIRL listener to throttle stats uploads and track per-payload
 * timestamps for staleness detection.
 *
 * The actual GPS processing (processGpsData, calculateSpeedFromPayload,
 * processAltitude) happens in the RTIRL listener in the parent and calls
 * the setters returned here.
 */
export function useMovementData() {
  // ── Displayed values ─────────────────────────────────────────────────────────
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [currentAltitude, setCurrentAltitude] = useState<number | null>(null);
  const [mapCoords, setMapCoords] = useState<[number, number] | null>(null);

  // ── Timestamps that trigger re-renders for staleness checks ─────────────────
  const [speedUpdateTimestamp, setSpeedUpdateTimestamp] = useState(0);
  const [altitudeUpdateTimestamp, setAltitudeUpdateTimestamp] = useState(0);
  /**
   * Triggers locationDisplay recalc (fresh→show neighbourhood from saved data,
   * no API call) when GPS freshness changes; a ref alone doesn't cause re-renders.
   */
  const [gpsTimestampForDisplay, setGpsTimestampForDisplay] = useState(0);

  // ── Altitude auto-display ────────────────────────────────────────────────────
  /** First altitude reading of the session — reference for change detection. */
  const altitudeBaselineRef = useRef<number | null>(null);
  /** Latest altitude value available to the timeout callback. */
  const currentAltitudeRef = useRef<number | null>(null);
  /** Unix-ms timestamp until which altitude should be shown (0 = hidden). */
  const [altitudeShowUntil, setAltitudeShowUntil] = useState(0);
  const altitudeShowTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Speed ref (read by minimap visibility without causing dep cycles) ────────
  const currentSpeedRef = useRef(0);

  // ── GPS rate-gating refs ─────────────────────────────────────────────────────
  /** Wall-clock time of last received GPS update (for minimap staleness). */
  const lastGpsUpdateTime = useRef(0);
  /** Payload-reported GPS timestamp of the last update (for speed calculation). */
  const lastGpsTimestamp = useRef(0);
  /** Last coordinate pair received. */
  const lastCoords = useRef<[number, number] | null>(null);
  /** Wall-clock time when lastCoords was stored. */
  const lastCoordsTime = useRef(0);

  // ── GPS timestamps for speed/altitude staleness ──────────────────────────────
  const lastSpeedGpsTimestamp = useRef(0);
  const lastAltitudeGpsTimestamp = useRef(0);

  // ── Stats upload throttling ──────────────────────────────────────────────────
  const lastStatsUpdateTime = useRef(0);
  const lastSentSpeed = useRef<number | null>(null);
  const lastSentAltitude = useRef<number | null>(null);

  return {
    // State
    currentSpeed,
    setCurrentSpeed,
    currentAltitude,
    setCurrentAltitude,
    mapCoords,
    setMapCoords,
    speedUpdateTimestamp,
    setSpeedUpdateTimestamp,
    altitudeUpdateTimestamp,
    setAltitudeUpdateTimestamp,
    gpsTimestampForDisplay,
    setGpsTimestampForDisplay,
    altitudeShowUntil,
    setAltitudeShowUntil,
    // Refs
    altitudeBaselineRef,
    currentAltitudeRef,
    altitudeShowTimeoutRef,
    currentSpeedRef,
    lastGpsUpdateTime,
    lastGpsTimestamp,
    lastCoords,
    lastCoordsTime,
    lastSpeedGpsTimestamp,
    lastAltitudeGpsTimestamp,
    lastStatsUpdateTime,
    lastSentSpeed,
    lastSentAltitude,
  };
}
