/**
 * POST: Receive wellness data from Health Auto Export (or similar).
 * Requires X-Wellness-Secret header to match WELLNESS_IMPORT_SECRET env.
 * Supports two formats:
 * 1. Flat: { steps, activeCalories, distanceKm, ... }
 * 2. Health Auto Export: { data: { metrics: [{ name, units, data: [{ qty, date, ... }] }] } }
 *
 * Health Auto Export should be configured to send TODAY'S CUMULATIVE TOTALS (not "Since last sync").
 * The server calculates deltas as (newTotal - lastKnown), recovering late Apple Watch data automatically.
 *
 * Active metrics: step_count, active_energy, walking_running_distance.
 * Body metrics (optional): body_mass, body_mass_index, body_fat_percentage, lean_body_mass.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { kv } from '@/lib/kv';
import { updateWellnessData, getWellnessData } from '@/utils/wellness-storage';
import type { WellnessData } from '@/utils/wellness-storage';

const IMPORT_DEDUP_TTL_SEC = 30; // seconds — reject identical payloads within this window

export const dynamic = 'force-dynamic';

function parseNumber(val: unknown): number | undefined {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}


/** Health Auto Export metrics format: { name, units?, data: [{ qty, date, source?, Avg?, Min?, Max? }] } */
interface HealthMetric {
  name?: string;
  units?: string;
  data?: Array<{ qty?: number; date?: string; Avg?: number; Min?: number; Max?: number }>;
}

/** Normalize units string for comparison (lowercase, strip whitespace) */
function normUnits(u: string | undefined): string {
  return (u ?? '').toLowerCase().trim();
}

/** Parse energy to kcal. Health Auto Export / Apple Health: kJ or kcal (user preference). 1 kcal = 4.184 kJ. */
function energyToKcal(val: number, units: string | undefined): number {
  const u = normUnits(units);
  if (u.includes('kcal') || u.includes('cal') || u === 'c') return val;
  return val * 0.239; // kJ → kcal
}

/** Parse distance to km. Apple Health stores meters; Health Auto Export may export m, km, or mi per user preference. */
function distanceToKm(val: number, units: string | undefined): number {
  const u = normUnits(units);
  if (u.includes('km')) return val;
  if (u.includes('mi') || u.includes('mile')) return val * 1.60934;
  return val / 1000; // default: meters (Apple Health native unit)
}

function parseHealthAutoExport(body: Record<string, unknown>): { updates: Partial<WellnessData> } {
  const data = body.data as { metrics?: HealthMetric[] } | undefined;
  const metrics = data?.metrics;
  const emptyResult = { updates: {} as Partial<WellnessData>, sessionTotals: {} };
  if (!Array.isArray(metrics)) return emptyResult;

  const byName = new Map<string, HealthMetric>();
  for (const m of metrics) {
    if (m?.name) byName.set(m.name, m);
  }

  const updates: Partial<WellnessData> = {};

  // Sum all data points — Health Auto Export sends today's cumulative total each push
  const sumQty = (m: HealthMetric | undefined): number => {
    if (!m?.data || !Array.isArray(m.data)) return 0;
    return m.data.reduce((s, d) => s + (typeof d.qty === 'number' ? d.qty : 0), 0);
  };
  const lastQty = (m: HealthMetric | undefined): number | undefined => {
    if (!m?.data?.length) return undefined;
    const last = m.data[m.data.length - 1];
    return typeof last?.qty === 'number' ? last.qty : undefined;
  };
  const lastAvg = (m: HealthMetric | undefined): number | undefined => {
    if (!m?.data?.length) return undefined;
    const last = m.data[m.data.length - 1];
    return typeof last?.Avg === 'number' ? last.Avg : undefined;
  };

  // step_count
  const stepCount = byName.get('step_count');
  if (stepCount) {
    const total = Math.round(sumQty(stepCount));
    if (total >= 0) updates.steps = total;
  }

  // active_energy
  const activeEnergy = byName.get('active_energy') ?? byName.get('activeEnergyBurned') ?? byName.get('active_energy_burned');
  if (activeEnergy) {
    updates.activeCalories = Math.max(0, Math.round(energyToKcal(sumQty(activeEnergy), activeEnergy.units)));
  }

  // walking_running_distance
  const walkingDist = byName.get('walking_running_distance');
  if (walkingDist) {
    updates.distanceKm = Math.max(0, Math.round(distanceToKm(sumQty(walkingDist), walkingDist.units) * 1000) / 1000);
  }

  // Body metrics (optional, unchanged)
  const heightMetric = byName.get('height') ?? byName.get('body_height') ?? byName.get('stature');
  if (heightMetric) {
    const raw = lastQty(heightMetric);
    if (raw != null && raw > 0) {
      const units = normUnits(heightMetric.units);
      let cm: number;
      if (units.includes('in') && !units.includes('cm')) cm = raw * 2.54;
      else if (units.includes('ft') || units.includes('foot')) cm = raw * 30.48;
      else if (units.includes('m') && raw < 10) cm = raw * 100;
      else cm = raw;
      const rounded = Math.round(Math.max(0, cm) * 10) / 10;
      if (rounded > 0) updates.heightCm = rounded;
    }
  }

  const bodyMass = byName.get('body_mass') ?? byName.get('weight_body_mass') ?? byName.get('mass') ?? byName.get('weight');
  if (bodyMass) {
    const raw = lastQty(bodyMass);
    if (raw != null && raw > 0) {
      const units = normUnits(bodyMass.units);
      const kg = units.includes('lb') ? raw * 0.453592 : raw;
      const rounded = Math.round(kg * 100) / 100;
      if (rounded > 0) updates.weightKg = rounded;
    }
  }

  const bmiMetric = byName.get('body_mass_index') ?? byName.get('bmi');
  const bmiVal = lastQty(bmiMetric) ?? lastAvg(bmiMetric);
  if (bmiVal != null && bmiVal > 0) updates.bodyMassIndex = Math.round(bmiVal * 10) / 10;

  const bodyFatMetric = byName.get('body_fat_percentage') ?? byName.get('body_fat') ?? byName.get('bodyFatPercentage');
  const bodyFatVal = lastQty(bodyFatMetric) ?? lastAvg(bodyFatMetric);
  if (bodyFatVal != null && bodyFatVal > 0) {
    const pct = bodyFatVal <= 1 ? bodyFatVal * 100 : bodyFatVal;
    const rounded = Math.round(pct * 10) / 10;
    if (rounded > 0) updates.bodyFatPercent = rounded;
  }

  const leanMassMetric = byName.get('lean_body_mass') ?? byName.get('leanBodyMass');
  const leanMassVal = lastQty(leanMassMetric) ?? lastAvg(leanMassMetric);
  if (leanMassVal != null && leanMassVal > 0) {
    const units = normUnits(leanMassMetric?.units);
    const kg = units.includes('lb') ? leanMassVal * 0.453592 : leanMassVal;
    const rounded = Math.round(kg * 100) / 100;
    if (rounded > 0) updates.leanBodyMassKg = rounded;
  }

  return { updates };
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
      const data = body.data as { metrics?: Array<{ name?: string }> };
      const metricNames = (data.metrics ?? []).map(m => m?.name).filter(Boolean) as string[];
      const parsed = parseHealthAutoExport(body);
      Object.assign(updates, parsed.updates);
      const parts = [
        parsed.updates.steps != null && `steps=${parsed.updates.steps}`,
        parsed.updates.activeCalories != null && `cal=${parsed.updates.activeCalories}`,
        parsed.updates.distanceKm != null && `dist=${parsed.updates.distanceKm}km`,
      ].filter(Boolean).join(' ');
      console.log(`[Wellness] HAE received=[${metricNames.join(',')}] ${parts || '(no tracked metrics)'}`);
    }

    // Flat format
    if (body.steps !== undefined) updates.steps = Math.max(0, Math.floor(parseNumber(body.steps) ?? 0));
    if (body.activeCalories !== undefined) updates.activeCalories = Math.max(0, parseNumber(body.activeCalories) ?? 0);
    if (body.distanceKm !== undefined) updates.distanceKm = Math.max(0, parseNumber(body.distanceKm) ?? 0);
    const heightVal = body.heightCm !== undefined ? Math.max(0, parseNumber(body.heightCm) ?? 0) : undefined;
    if (heightVal != null && heightVal > 0) updates.heightCm = heightVal;
    const weightVal = body.weightKg !== undefined ? Math.max(0, parseNumber(body.weightKg) ?? 0) : undefined;
    if (weightVal != null && weightVal > 0) updates.weightKg = weightVal;
    const bmiVal = body.bodyMassIndex !== undefined ? Math.max(0, parseNumber(body.bodyMassIndex) ?? 0) : undefined;
    if (bmiVal != null && bmiVal > 0) updates.bodyMassIndex = bmiVal;
    const bodyFatVal = body.bodyFatPercent !== undefined ? Math.max(0, Math.min(100, parseNumber(body.bodyFatPercent) ?? 0)) : undefined;
    if (bodyFatVal != null && bodyFatVal > 0) updates.bodyFatPercent = bodyFatVal;
    const leanVal = body.leanBodyMassKg !== undefined ? Math.max(0, parseNumber(body.leanBodyMassKg) ?? 0) : undefined;
    if (leanVal != null && leanVal > 0) updates.leanBodyMassKg = leanVal;

    if (Object.keys(updates).length === 0) {
      console.warn('[Wellness] No valid fields.', { topLevelKeys: Object.keys(body) });
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    // Auto-calculate BMI from weight + height when BMI wasn't supplied directly
    if (updates.weightKg && !updates.bodyMassIndex) {
      const heightCm = updates.heightCm ?? (await getWellnessData())?.heightCm;
      if (heightCm && heightCm > 0) {
        const heightM = heightCm / 100;
        updates.bodyMassIndex = Math.round((updates.weightKg / (heightM * heightM)) * 10) / 10;
        console.log(`[Wellness] BMI auto-calculated: ${updates.bodyMassIndex} (${updates.weightKg}kg, ${heightCm}cm)`);
      }
    }

    // Idempotency check — reject identical payloads within IMPORT_DEDUP_TTL_SEC
    const dedupPayload = JSON.stringify(
      Object.fromEntries(Object.entries(updates).sort(([a], [b]) => a.localeCompare(b)))
    );
    const dedupHash = createHash('sha256').update(dedupPayload).digest('hex').slice(0, 20);
    const dedupKey = `wellness_import_dedup:${dedupHash}`;
    const alreadySeen = await kv.get(dedupKey);
    if (alreadySeen) {
      console.log(`[Wellness] Duplicate payload ignored (hash=${dedupHash})`);
      return NextResponse.json({ ok: true, skipped: true });
    }
    await kv.set(dedupKey, 1, { ex: IMPORT_DEDUP_TTL_SEC });

    await updateWellnessData(updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Wellness import failed:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
