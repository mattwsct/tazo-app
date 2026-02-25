// === 🏃 WELLNESS STORAGE ===
// Human health data from Health Auto Export (steps, calories, distance, flights, etc.)
// Separate from stats (stream-session speed/altitude/heart rate from Pulsoid/RTIRL)
//
// Steps session: Tracks steps accumulated since stream start.
// Health Auto Export "Since last sync" mode sends incremental deltas each push — we add each
// value directly. No cumulative/daily-reset logic; midnight is handled by the app if it sends
// all new data since last sync. Reset only when stream goes live.

import { kv } from '@vercel/kv';

const WELLNESS_KEY = 'wellness_data';
const WELLNESS_STEPS_SESSION_KEY = 'wellness_steps_session';
const WELLNESS_DISTANCE_SESSION_KEY = 'wellness_distance_session';
const WELLNESS_FLIGHTS_SESSION_KEY = 'wellness_flights_session';
const WELLNESS_ACTIVE_CALORIES_SESSION_KEY = 'wellness_active_calories_session';
const WELLNESS_LAST_IMPORT_KEY = 'wellness_last_import';

/** Tracks last imported value+time per metric to deduplicate rapid/duplicate pushes. */
interface WellnessLastImport {
  steps?: { value: number; at: number };
  distanceKm?: { value: number; at: number };
  flightsClimbed?: { value: number; at: number };
  activeCalories?: { value: number; at: number };
}

const DEDUP_SAME_VALUE_MS = 60_000;   // Same value within 60s → treat as duplicate push

async function getLastImport(): Promise<WellnessLastImport> {
  try {
    const data = await kv.get<WellnessLastImport>(WELLNESS_LAST_IMPORT_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

/** Most recent timestamp from any session metric import. */
export async function getLastSessionUpdateAt(): Promise<number> {
  const state = await getLastImport();
  let latest = 0;
  for (const v of Object.values(state)) {
    if (v && v.at > latest) latest = v.at;
  }
  return latest;
}

/** Timestamp when a specific session metric was last imported. */
export async function getLastSessionMetricUpdateAt(
  metric: keyof WellnessLastImport
): Promise<number> {
  const state = await getLastImport();
  return state[metric]?.at ?? 0;
}

async function setLastImportMetric(metric: keyof WellnessLastImport, value: number): Promise<void> {
  try {
    const existing = await getLastImport();
    await kv.set(WELLNESS_LAST_IMPORT_KEY, {
      ...existing,
      [metric]: { value, at: Date.now() },
    });
  } catch (error) {
    console.error('Failed to update wellness last import:', error);
  }
}

/** Returns true if we should skip this session update (duplicate push only). */
function shouldSkipSessionUpdate(
  lastImport: { value: number; at: number } | undefined,
  newValue: number,
  _lastKnown: number,
  now: number
): boolean {
  if (!lastImport) return false;

  // Same value within window → duplicate push, skip
  if (newValue === lastImport.value && (now - lastImport.at) < DEDUP_SAME_VALUE_MS) {
    return true;
  }

  return false;
}

/** Call when stream goes live. Clears last-import timestamps so dedup state doesn't carry over from prior stream. */
export async function resetWellnessLastImport(): Promise<void> {
  try {
    await kv.del(WELLNESS_LAST_IMPORT_KEY);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Wellness] Last import dedup state cleared (stream start)');
    }
  } catch (error) {
    console.error('Failed to reset wellness last import:', error);
  }
}

export interface AccumulatorSession {
  accumulated: number;
  lastKnown: number;
}

export type StepsSession = AccumulatorSession;
export type DistanceSession = AccumulatorSession;
export type FlightsSession = AccumulatorSession;
export type ActiveCaloriesSession = AccumulatorSession;

/** Per-metric timestamps (ms) — when each field was last updated. Falls back to updatedAt if missing. */
export type WellnessMetricKey = 'steps' | 'distanceKm' | 'flightsClimbed' | 'activeCalories' | 'restingCalories' | 'totalCalories' | 'heightCm' | 'weightKg' | 'bodyMassIndex' | 'bodyFatPercent' | 'leanBodyMassKg' | 'heartRate' | 'restingHeartRate';

export interface WellnessData {
  steps?: number;
  activeCalories?: number;
  restingCalories?: number;
  totalCalories?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  heightCm?: number;         // Height in cm (from Health Auto Export / manual)
  weightKg?: number;         // Body mass in kg (from Health Auto Export / smart scale)
  bodyMassIndex?: number;   // BMI (from Health Auto Export / smart scale)
  bodyFatPercent?: number;  // Body fat % (0–100, from smart scale)
  leanBodyMassKg?: number;   // Lean body mass in kg (from smart scale)
  heartRate?: number;        // From Apple Health (resting etc) — live BPM stays in stats from Pulsoid
  restingHeartRate?: number;
  updatedAt: number;
  /** When each metric was last updated (ms). Key = metric name. Falls back to updatedAt. */
  metricUpdatedAt?: Partial<Record<WellnessMetricKey, number>>;
}

export async function getWellnessData(): Promise<WellnessData | null> {
  try {
    const data = await kv.get<WellnessData>(WELLNESS_KEY);
    return data;
  } catch {
    return null;
  }
}

const WELLNESS_DATA_KEYS: readonly WellnessMetricKey[] = [
  'steps', 'distanceKm', 'flightsClimbed', 'activeCalories', 'restingCalories', 'totalCalories',
  'heightCm', 'weightKg', 'bodyMassIndex', 'bodyFatPercent', 'leanBodyMassKg', 'heartRate', 'restingHeartRate',
];

export interface UpdateWellnessOptions {
  /** When true, do not set metric timestamps (manual admin entry — no "(X ago)" shown) */
  fromManualEntry?: boolean;
}

/** Float metrics: treat as "unchanged" if within tolerance (avoids "just now" on re-import of same values). */
const FLOAT_METRIC_EPSILON: Partial<Record<WellnessMetricKey, number>> = {
  weightKg: 0.01,
  bodyMassIndex: 0.01,
  bodyFatPercent: 0.01,
  leanBodyMassKg: 0.01,
  heightCm: 0.01,
  distanceKm: 0.001,
};

function isMetricValueChanged(key: WellnessMetricKey, existingVal: unknown, newVal: unknown): boolean {
  if (existingVal === newVal) return false;
  const eps = FLOAT_METRIC_EPSILON[key];
  if (eps != null && typeof existingVal === 'number' && typeof newVal === 'number') {
    return Math.abs(newVal - existingVal) >= eps;
  }
  return true;
}

export async function updateWellnessData(updates: Partial<WellnessData>, options?: UpdateWellnessOptions): Promise<void> {
  try {
    const existing = await kv.get<WellnessData>(WELLNESS_KEY);
    const now = Date.now();
    const metricUpdatedAt = { ...(existing?.metricUpdatedAt ?? {}) };
    const fromManualEntry = options?.fromManualEntry === true;
    for (const key of WELLNESS_DATA_KEYS) {
      const newVal = updates[key as keyof WellnessData];
      if (newVal === undefined) continue;
      if (fromManualEntry) {
        metricUpdatedAt[key] = 0;  // 0 = no timestamp, don't show "(X ago)" for manual entry
      } else {
        const existingVal = existing?.[key as keyof WellnessData];
        if (isMetricValueChanged(key, existingVal, newVal)) {
          metricUpdatedAt[key] = now;
        }
      }
    }
    const merged: WellnessData = {
      ...(existing || {}),
      ...updates,
      updatedAt: now,
      metricUpdatedAt,
    };
    await kv.set(WELLNESS_KEY, merged);
  } catch (error) {
    console.error('Failed to update wellness data:', error);
    throw error;
  }
}

/** Get the timestamp when a metric (or group) was last updated. Uses metricUpdatedAt, falls back to updatedAt. */
export function getMetricUpdatedAt(wellness: WellnessData | null | undefined, metric: WellnessMetricKey | WellnessMetricKey[]): number {
  if (!wellness) return 0;
  const fallback = wellness.updatedAt ?? 0;
  const map = wellness.metricUpdatedAt;
  if (!map) return fallback;
  if (Array.isArray(metric)) {
    const timestamps = metric.map(m => map[m]).filter((t): t is number => typeof t === 'number' && t > 0);
    return timestamps.length > 0 ? Math.max(...timestamps) : fallback;
  }
  return map[metric] ?? fallback;
}

// === Generic accumulator session (steps, distance, flights, active calories) ===
// All 4 metrics follow the same pattern: accumulate deltas since stream start, handle midnight resets.

interface SessionConfig {
  kvKey: string;
  importMetric: keyof WellnessLastImport;
  normalize: (v: number) => number;
  roundAccumulated?: (v: number) => number;
}

const SESSION_CONFIGS: Record<string, SessionConfig> = {
  steps: { kvKey: WELLNESS_STEPS_SESSION_KEY, importMetric: 'steps', normalize: (v) => Math.max(0, Math.floor(v)) },
  distance: { kvKey: WELLNESS_DISTANCE_SESSION_KEY, importMetric: 'distanceKm', normalize: (v) => Math.max(0, v), roundAccumulated: (v) => Math.round(v * 1000) / 1000 },
  flights: { kvKey: WELLNESS_FLIGHTS_SESSION_KEY, importMetric: 'flightsClimbed', normalize: (v) => Math.max(0, Math.floor(v)) },
  activeCalories: { kvKey: WELLNESS_ACTIVE_CALORIES_SESSION_KEY, importMetric: 'activeCalories', normalize: (v) => Math.max(0, Math.round(v)) },
};

async function getSession(config: SessionConfig): Promise<AccumulatorSession | null> {
  try { return await kv.get<AccumulatorSession>(config.kvKey); } catch { return null; }
}

async function getSinceStreamStart(config: SessionConfig): Promise<number> {
  return (await getSession(config))?.accumulated ?? 0;
}

async function resetSession(config: SessionConfig, currentValue: number): Promise<void> {
  try {
    await kv.set(config.kvKey, { accumulated: 0, lastKnown: config.normalize(currentValue) });
  } catch (error) {
    console.error(`Failed to reset ${config.importMetric} session:`, error);
    throw error;
  }
}

async function updateSession(config: SessionConfig, newValue: number): Promise<void> {
  try {
    const val = config.normalize(newValue);
    const now = Date.now();
    const lastImportState = await getLastImport();
    const existing = await getSession(config);
    const lastKnown = existing?.lastKnown ?? 0;
    const accumulated = existing?.accumulated ?? 0;

    if (shouldSkipSessionUpdate(lastImportState[config.importMetric], val, lastKnown, now)) {
      console.log('[Wellness session]', config.importMetric + ': skipped (duplicate within dedup window)');
      return;
    }

    // Additive mode: each push is the delta since last sync, add it directly
    const delta = val;
    const newAccumulated = config.roundAccumulated ? config.roundAccumulated(accumulated + delta) : accumulated + delta;
    console.log('[Wellness session]', config.importMetric + ':', {
      incoming: val,
      delta,
      accumulated,
      newAccumulated,
    });
    await kv.set(config.kvKey, { accumulated: newAccumulated, lastKnown: val });
    await setLastImportMetric(config.importMetric, val);
  } catch (error) {
    console.error(`Failed to update ${config.importMetric} session:`, error);
    throw error;
  }
}

// Steps
export const getStepsSession = () => getSession(SESSION_CONFIGS.steps);
export const getStepsSinceStreamStart = () => getSinceStreamStart(SESSION_CONFIGS.steps);
export const resetStepsSession = (current: number) => resetSession(SESSION_CONFIGS.steps, current);
export const updateStepsSession = (value: number) => updateSession(SESSION_CONFIGS.steps, value);

// Distance
export const getDistanceSession = () => getSession(SESSION_CONFIGS.distance);
export const getDistanceSinceStreamStart = () => getSinceStreamStart(SESSION_CONFIGS.distance);
export const resetDistanceSession = (current: number) => resetSession(SESSION_CONFIGS.distance, current);
export const updateDistanceSession = (value: number) => updateSession(SESSION_CONFIGS.distance, value);

// Flights
export const getFlightsSession = () => getSession(SESSION_CONFIGS.flights);
export const getFlightsSinceStreamStart = () => getSinceStreamStart(SESSION_CONFIGS.flights);
export const resetFlightsSession = (current: number) => resetSession(SESSION_CONFIGS.flights, current);
export const updateFlightsSession = (value: number) => updateSession(SESSION_CONFIGS.flights, value);

// Active calories
export const getActiveCaloriesSession = () => getSession(SESSION_CONFIGS.activeCalories);
export const getActiveCaloriesSinceStreamStart = () => getSinceStreamStart(SESSION_CONFIGS.activeCalories);
export const resetActiveCaloriesSession = (current: number) => resetSession(SESSION_CONFIGS.activeCalories, current);
export const updateActiveCaloriesSession = (value: number) => updateSession(SESSION_CONFIGS.activeCalories, value);

// === Wellness milestones (reset on stream start) ===

const WELLNESS_MILESTONES_LAST_SENT_KEY = 'wellness_milestones_last_sent';

export interface WellnessMilestonesLastSent {
  steps?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  activeCalories?: number;
}

export async function getWellnessMilestonesLastSent(): Promise<WellnessMilestonesLastSent> {
  try {
    const data = await kv.get<WellnessMilestonesLastSent>(WELLNESS_MILESTONES_LAST_SENT_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

export async function resetWellnessMilestonesOnStreamStart(): Promise<void> {
  try {
    await kv.del(WELLNESS_MILESTONES_LAST_SENT_KEY);
  } catch (error) {
    console.error('Failed to reset wellness milestones:', error);
  }
}

export async function setWellnessMilestoneLastSent(
  metric: keyof WellnessMilestonesLastSent,
  value: number
): Promise<void> {
  try {
    const current = await getWellnessMilestonesLastSent();
    await kv.set(WELLNESS_MILESTONES_LAST_SENT_KEY, { ...current, [metric]: value });
  } catch (error) {
    console.error('Failed to set wellness milestone last sent:', error);
  }
}
