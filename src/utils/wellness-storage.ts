// === 🏃 WELLNESS STORAGE ===
// Human health data from Health Auto Export (steps, calories, distance, body metrics).
// Health Auto Export is configured for "Today" — sends one entry per interval; server sums for daily total.
// Data resets naturally at midnight — no stream-based session tracking needed.

import { kv } from '@/lib/kv';

const WELLNESS_KEY = 'wellness_data';
const WELLNESS_SNAPSHOT_AT_STREAM_END_KEY = 'wellness_snapshot_at_stream_end';
const WELLNESS_LAST_MIDNIGHT_RESET_DATE_KEY = 'wellness_last_midnight_reset_date';

/** Snapshot of session metrics at stream end so they don't update when offline */
export interface WellnessSnapshotAtStreamEnd {
  steps?: number;
  distanceKm?: number;
  updatedAt: number;
}

/** Per-metric timestamps (ms) — when each field was last updated. Falls back to updatedAt if missing. */
export type WellnessMetricKey = 'steps' | 'distanceKm' | 'heightCm' | 'weightKg';

export interface WellnessData {
  steps?: number;
  distanceKm?: number;
  heightCm?: number;
  weightKg?: number;
  updatedAt: number;
  /** Per-metric last-updated timestamps (ms). Falls back to updatedAt. */
  metricUpdatedAt?: Partial<Record<WellnessMetricKey, number>>;
}

// In-memory cache — wellness data only changes when Health Auto Export posts (every 30–60s).
// 10s TTL means the overlay's frequent polling is served from memory, not KV.
const WELLNESS_CACHE_TTL = 10_000;

declare global {
  var __wellnessCache: { value: WellnessData | null; expiresAt: number } | undefined;
}

function setWellnessCache(value: WellnessData | null): void {
  globalThis.__wellnessCache = { value, expiresAt: Date.now() + WELLNESS_CACHE_TTL };
}

export async function getWellnessData(): Promise<WellnessData | null> {
  const now = Date.now();
  const cached = globalThis.__wellnessCache;
  if (cached && now < cached.expiresAt) return cached.value;

  try {
    const data = await kv.get<WellnessData>(WELLNESS_KEY);
    setWellnessCache(data);
    return data;
  } catch {
    return null;
  }
}

/** Get wellness data for overlay display. Always returns current steps/distance (no snapshot freeze). */
export async function getWellnessDataForDisplay(): Promise<WellnessData | null> {
  return getWellnessData();
}

/** Set snapshot of session metrics at stream end. Call when stream ends. */
export async function setWellnessSnapshotAtStreamEnd(): Promise<void> {
  try {
    const data = await getWellnessData();
    const now = Date.now();
    await kv.set(WELLNESS_SNAPSHOT_AT_STREAM_END_KEY, {
      steps: data?.steps,
      distanceKm: data?.distanceKm,
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

/**
 * If it is now a new calendar day in the given timezone, reset steps and distanceKm to 0 for cleanliness
 * (next Health Auto Export will show new day's data).
 * Uses IANA timezone (e.g. "America/New_York", "UTC"). Call from a cron that runs at least once per minute.
 * @returns true if a reset was performed
 */
export async function resetWellnessDailyMetricsAtMidnight(timezone: string): Promise<boolean> {
  if (!timezone?.trim()) return false;
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const lastReset = await kv.get<string>(WELLNESS_LAST_MIDNIGHT_RESET_DATE_KEY);
    if (lastReset === dateStr) return false;

    const existing = await kv.get<WellnessData>(WELLNESS_KEY);
    const ts = Date.now();
    const metricUpdatedAt = { ...(existing?.metricUpdatedAt ?? {}) };
    metricUpdatedAt.steps = ts;
    metricUpdatedAt.distanceKm = ts;

    const merged: WellnessData = {
      ...(existing || {}),
      steps: 0,
      distanceKm: 0,
      updatedAt: ts,
      metricUpdatedAt,
    };
    await kv.set(WELLNESS_KEY, merged);
    setWellnessCache(merged);
    await kv.set(WELLNESS_LAST_MIDNIGHT_RESET_DATE_KEY, dateStr);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Wellness] Midnight reset in', timezone, 'date', dateStr);
    }
    return true;
  } catch (error) {
    console.warn('Failed to reset wellness at midnight:', error);
    return false;
  }
}

const WELLNESS_DATA_KEYS: readonly WellnessMetricKey[] = [
  'steps', 'distanceKm', 'heightCm', 'weightKg',
];

export interface UpdateWellnessOptions {
  /** When true, do not set metric timestamps (manual admin entry — no "(X ago)" shown) */
  fromManualEntry?: boolean;
}

/** Float metrics: treat as "unchanged" if within tolerance (avoids "just now" on re-import of same values). */
const FLOAT_METRIC_EPSILON: Partial<Record<WellnessMetricKey, number>> = {
  weightKg: 0.01,
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
    setWellnessCache(merged);
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
