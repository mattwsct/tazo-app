/**
 * POST: Receive wellness data from Health Auto Export (or similar).
 * Requires X-Wellness-Secret header to match WELLNESS_IMPORT_SECRET env.
 * Supports two formats:
 * 1. Flat: { steps, activeCalories, restingCalories, ... }
 * 2. Health Auto Export: { data: { metrics: [{ name, units, data: [{ qty, date, ... }] }] } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateWellnessData, updateStepsSession, updateDistanceSession, updateHandwashingSession } from '@/utils/wellness-storage';
import type { WellnessData } from '@/utils/wellness-storage';

export const dynamic = 'force-dynamic';

function parseNumber(val: unknown): number | undefined {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function parseString(val: unknown): string | undefined {
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

/** Health Auto Export metrics format: { name, units?, data: [{ qty, date, source?, Avg?, Min?, Max? }] } */
interface HealthMetric {
  name?: string;
  units?: string;
  data?: Array<{ qty?: number; date?: string; Avg?: number; Min?: number; Max?: number }>;
}

function parseHealthAutoExport(body: Record<string, unknown>): Partial<WellnessData> {
  const data = body.data as { metrics?: HealthMetric[] } | undefined;
  const metrics = data?.metrics;
  if (!Array.isArray(metrics)) return {};

  const byName = new Map<string, HealthMetric>();
  for (const m of metrics) {
    if (m?.name) byName.set(m.name, m);
  }

  const updates: Partial<WellnessData> = {};
  const sumQty = (m: HealthMetric | undefined): number => {
    if (!m?.data || !Array.isArray(m.data)) return 0;
    return m.data.reduce((s, d) => s + (typeof d.qty === 'number' ? d.qty : 0), 0);
  };
  const lastAvg = (m: HealthMetric | undefined): number | undefined => {
    if (!m?.data?.length) return undefined;
    const last = m.data[m.data.length - 1];
    return typeof last?.Avg === 'number' ? last.Avg : undefined;
  };
  const lastQty = (m: HealthMetric | undefined): number | undefined => {
    if (!m?.data?.length) return undefined;
    const last = m.data[m.data.length - 1];
    return typeof last?.qty === 'number' ? last.qty : undefined;
  };

  const stepCount = byName.get('step_count');
  if (stepCount) {
    const total = Math.round(sumQty(stepCount));
    if (total >= 0) updates.steps = total;
  }

  const activeEnergy = byName.get('active_energy');
  if (activeEnergy) {
    const kJ = sumQty(activeEnergy);
    updates.activeCalories = Math.max(0, Math.round(kJ * 0.239));
  }

  const basalEnergy = byName.get('basal_energy_burned') ?? byName.get('resting_energy');
  if (basalEnergy) {
    const kJ = sumQty(basalEnergy);
    updates.restingCalories = Math.max(0, Math.round(kJ * 0.239));
  }

  if (updates.activeCalories != null || updates.restingCalories != null) {
    updates.totalCalories = (updates.activeCalories ?? 0) + (updates.restingCalories ?? 0);
  }

  const standHour = byName.get('apple_stand_hour');
  if (standHour) updates.standHours = Math.max(0, Math.round(sumQty(standHour)));

  const walkingDist = byName.get('walking_running_distance');
  if (walkingDist) updates.distanceKm = Math.max(0, Math.round(sumQty(walkingDist) * 1000) / 1000);

  const handwashing = byName.get('handwashing');
  if (handwashing) updates.handwashingCount = Math.max(0, Math.round(sumQty(handwashing)));

  // Body mass: HealthKit uses body_mass; some exporters use mass or weight.
  // Assume kg (Apple Health standard). If units are 'lb', convert: qty * 0.453592
  const bodyMass = byName.get('body_mass') ?? byName.get('mass') ?? byName.get('weight');
  if (bodyMass) {
    const raw = lastQty(bodyMass);
    if (raw != null && raw >= 0) {
      const units = (bodyMass.units || '').toLowerCase();
      const kg = units === 'lb' || units === 'lbs' ? raw * 0.453592 : raw;
      updates.weightKg = Math.round(kg * 100) / 100;
    }
  }

  const hr = byName.get('heart_rate');
  const bpm = lastAvg(hr);
  if (bpm != null && bpm >= 0) updates.heartRate = Math.round(bpm);

  const restingHr = byName.get('resting_heart_rate');
  const restingBpm = lastAvg(restingHr) ?? lastQty(restingHr);
  if (restingBpm != null && restingBpm >= 0) updates.restingHeartRate = Math.round(restingBpm);

  const hrvMetric = byName.get('heart_rate_variability_sdnn') ?? byName.get('heart_rate_variability');
  const hrvVal = lastAvg(hrvMetric) ?? lastQty(hrvMetric);
  if (hrvVal != null && hrvVal >= 0) updates.hrv = Math.round(hrvVal);

  return updates;
}

function getMetricNamesFromPayload(body: Record<string, unknown>): string[] {
  const data = body.data as { metrics?: Array<{ name?: string }> } | undefined;
  const metrics = data?.metrics;
  if (!Array.isArray(metrics)) return [];
  return metrics.map((m) => m?.name).filter((n): n is string => !!n);
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-wellness-secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const expected = process.env.WELLNESS_IMPORT_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const updates: Partial<WellnessData> = {};

    // Health Auto Export format: { data: { metrics: [...] } }
    if (body.data && typeof body.data === 'object' && (body.data as { metrics?: unknown }).metrics) {
      const metricNames = getMetricNamesFromPayload(body);
      Object.assign(updates, parseHealthAutoExport(body));
      // Log received metrics and parsed updates — visible in Vercel Dashboard → Logs
      console.log('[Wellness import] Health Auto Export:', {
        received: metricNames,
        parsed: Object.keys(updates),
      });
    }

    // Flat format (also allow overriding from flat fields if present)
    if (body.steps !== undefined) updates.steps = Math.max(0, Math.floor(parseNumber(body.steps) ?? 0));
    if (body.activeCalories !== undefined) updates.activeCalories = Math.max(0, parseNumber(body.activeCalories) ?? 0);
    if (body.restingCalories !== undefined) updates.restingCalories = Math.max(0, parseNumber(body.restingCalories) ?? 0);
    if (body.totalCalories !== undefined) updates.totalCalories = Math.max(0, parseNumber(body.totalCalories) ?? 0);
    if (body.sleepHours !== undefined) updates.sleepHours = Math.max(0, parseNumber(body.sleepHours) ?? 0);
    if (body.sleepStart !== undefined) updates.sleepStart = parseString(body.sleepStart);
    if (body.sleepEnd !== undefined) updates.sleepEnd = parseString(body.sleepEnd);
    if (body.distanceKm !== undefined) updates.distanceKm = Math.max(0, parseNumber(body.distanceKm) ?? 0);
    if (body.flightsClimbed !== undefined) updates.flightsClimbed = Math.max(0, Math.floor(parseNumber(body.flightsClimbed) ?? 0));
    if (body.standHours !== undefined) updates.standHours = Math.max(0, parseNumber(body.standHours) ?? 0);
    if (body.handwashingCount !== undefined) updates.handwashingCount = Math.max(0, Math.floor(parseNumber(body.handwashingCount) ?? 0));
    if (body.weightKg !== undefined) updates.weightKg = Math.max(0, parseNumber(body.weightKg) ?? 0);
    if (body.heartRate !== undefined) updates.heartRate = Math.max(0, Math.floor(parseNumber(body.heartRate) ?? 0));
    if (body.restingHeartRate !== undefined) updates.restingHeartRate = Math.max(0, Math.floor(parseNumber(body.restingHeartRate) ?? 0));
    if (body.hrv !== undefined) updates.hrv = Math.max(0, parseNumber(body.hrv) ?? 0);

    if (Object.keys(updates).length === 0) {
      const metricNames = getMetricNamesFromPayload(body);
      console.warn('[Wellness import] No valid fields.', {
        topLevelKeys: Object.keys(body),
        healthAutoExportMetrics: metricNames.length ? metricNames : '(none)',
      });
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    // Log what we're saving (helps debug e.g. weight missing)
    console.log('[Wellness import] Saving:', Object.keys(updates));

    await updateWellnessData(updates);

    if (updates.steps !== undefined) {
      await updateStepsSession(updates.steps);
    }
    if (updates.distanceKm !== undefined) {
      await updateDistanceSession(updates.distanceKm);
    }
    if (updates.handwashingCount !== undefined) {
      await updateHandwashingSession(updates.handwashingCount);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Wellness import failed:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
