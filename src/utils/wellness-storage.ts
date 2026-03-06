// === 🏃 WELLNESS STORAGE ===
// Human health data from Health Auto Export (steps, calories, distance, body metrics).
// Health Auto Export is configured to send TODAY'S CUMULATIVE TOTALS each push.
// Data resets naturally at midnight — no stream-based session tracking needed.

import { kv } from '@/lib/kv';

const WELLNESS_KEY = 'wellness_data';
const WELLNESS_SNAPSHOT_AT_STREAM_END_KEY = 'wellness_snapshot_at_stream_end';

/** Snapshot of session metrics at stream end so they don't update when offline */
export interface WellnessSnapshotAtStreamEnd {
  steps?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  activeCalories?: number;
  updatedAt: number;
}

/** Per-metric timestamps (ms) — when each field was last updated. Falls back to updatedAt if missing. */
export type WellnessMetricKey = 'steps' | 'distanceKm' | 'flightsClimbed' | 'activeCalories' | 'restingCalories' | 'totalCalories' | 'heightCm' | 'weightKg' | 'bodyMassIndex' | 'bodyFatPercent' | 'leanBodyMassKg' | 'heartRate' | 'restingHeartRate';

export interface WellnessData {
  steps?: number;
  activeCalories?: number;
  restingCalories?: number;
  totalCalories?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  heightCm?: number;
  weightKg?: number;
  bodyMassIndex?: number;
  bodyFatPercent?: number;
  leanBodyMassKg?: number;
  heartRate?: number;
  restingHeartRate?: number;
  updatedAt: number;
  /** Per-metric last-updated timestamps (ms). Falls back to updatedAt. */
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

/** Get wellness data for display: when stream has ended, session metrics (steps, distance, flights, activeCal) are frozen from snapshot. */
export async function getWellnessDataForDisplay(): Promise<WellnessData | null> {
  const { isStreamLive } = await import('@/utils/stats-storage');
  const live = await isStreamLive();
  const data = await getWellnessData();
  if (live || !data) return data;
  const snapshot = await kv.get<WellnessSnapshotAtStreamEnd>(WELLNESS_SNAPSHOT_AT_STREAM_END_KEY);
  if (!snapshot) return data;
  return {
    ...data,
    steps: snapshot.steps ?? data.steps,
    distanceKm: snapshot.distanceKm ?? data.distanceKm,
    flightsClimbed: snapshot.flightsClimbed ?? data.flightsClimbed,
    activeCalories: snapshot.activeCalories ?? data.activeCalories,
    updatedAt: data.updatedAt,
  };
}

/** Set snapshot of session metrics at stream end. Call when stream ends. */
export async function setWellnessSnapshotAtStreamEnd(): Promise<void> {
  try {
    const data = await getWellnessData();
    const now = Date.now();
    await kv.set(WELLNESS_SNAPSHOT_AT_STREAM_END_KEY, {
      steps: data?.steps,
      distanceKm: data?.distanceKm,
      flightsClimbed: data?.flightsClimbed,
      activeCalories: data?.activeCalories,
      updatedAt: now,
    } as WellnessSnapshotAtStreamEnd);
  } catch (error) {
    console.error('Failed to set wellness snapshot at stream end:', error);
  }
}

/** Clear snapshot (call when stream starts). */
export async function clearWellnessSnapshotAtStreamEnd(): Promise<void> {
  try {
    await kv.set(WELLNESS_SNAPSHOT_AT_STREAM_END_KEY, null);
  } catch {
    // ignore
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
        metricUpdatedAt[key] = 0;
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

// === Wellness milestones ===
// Cron auto-detects midnight resets (value drops below last-sent milestone) and resets accordingly.

const WELLNESS_MILESTONES_LAST_SENT_KEY = 'wellness_milestones_last_sent';

export interface WellnessMilestonesLastSent {
  steps?: number;
  distanceKm?: number;
  activeCalories?: number;
}

export async function getWellnessMilestonesLastSent(): Promise<WellnessMilestonesLastSent> {
  try {
    return (await kv.get<WellnessMilestonesLastSent>(WELLNESS_MILESTONES_LAST_SENT_KEY)) ?? {};
  } catch {
    return {};
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
