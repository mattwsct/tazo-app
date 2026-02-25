/**
 * POST: Receive wellness data from Health Auto Export (or similar).
 * Requires X-Wellness-Secret header to match WELLNESS_IMPORT_SECRET env.
 * Supports two formats:
 * 1. Flat: { steps, activeCalories, restingCalories, ... }
 * 2. Health Auto Export: { data: { metrics: [{ name, units, data: [{ qty, date, ... }] }] } }
 *
 * Apple Health / HealthKit data types and units (Health Auto Export respects user unit prefs):
 * - step_count: HKQuantityType stepCount — count
 * - active_energy: activeEnergyBurned — kJ or kcal
 * - basal_energy_burned: basalEnergyBurned — kJ or kcal
 * - apple_stand_hour: stand hours count
 * - walking_running_distance: distanceWalkingRunning — m, km, or mi (Apple native: m)
 * - flights_climbed: flightsClimbed — count
 * - body_mass: bodyMass — kg or lb
 * - heart_rate, resting_heart_rate: bpm
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateWellnessData, updateStepsSession, updateDistanceSession, updateFlightsSession, updateActiveCaloriesSession } from '@/utils/wellness-storage';
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

  // step_count: HKQuantityTypeIdentifier.stepCount — count (no unit conversion)
  const stepCount = byName.get('step_count');
  if (stepCount) {
    const total = Math.round(sumQty(stepCount));
    if (total >= 0) updates.steps = total;
  }

  // active_energy / activeEnergyBurned: HKQuantityTypeIdentifier.activeEnergyBurned — kJ or kcal (user pref)
  const activeEnergy = byName.get('active_energy') ?? byName.get('activeEnergyBurned') ?? byName.get('active_energy_burned');
  if (activeEnergy) {
    const raw = sumQty(activeEnergy);
    updates.activeCalories = Math.max(0, Math.round(energyToKcal(raw, activeEnergy.units)));
  }

  // basal_energy_burned / resting_energy: HKQuantityTypeIdentifier.basalEnergyBurned — kJ or kcal
  const basalEnergy = byName.get('basal_energy_burned') ?? byName.get('resting_energy');
  if (basalEnergy) {
    const raw = sumQty(basalEnergy);
    updates.restingCalories = Math.max(0, Math.round(energyToKcal(raw, basalEnergy.units)));
  }

  if (updates.activeCalories != null || updates.restingCalories != null) {
    updates.totalCalories = (updates.activeCalories ?? 0) + (updates.restingCalories ?? 0);
  }

  // walking_running_distance: HKQuantityTypeIdentifier.distanceWalkingRunning — Apple stores meters; export may be m, km, mi
  const walkingDist = byName.get('walking_running_distance');
  if (walkingDist) {
    const raw = sumQty(walkingDist);
    const km = distanceToKm(raw, walkingDist.units);
    updates.distanceKm = Math.max(0, Math.round(km * 1000) / 1000);
  }

  // flights_climbed: HKQuantityTypeIdentifier.flightsClimbed — count
  const flights = byName.get('flights_climbed');
  if (flights) {
    const total = Math.max(0, Math.round(sumQty(flights)));
    updates.flightsClimbed = total;
  }

  // height: HKQuantityTypeIdentifier.height — typically m or cm (Apple Health uses m)
  // Only include if > 0 — empty/zero latest = no new data, don't overwrite or stamp "just now"
  const heightMetric = byName.get('height') ?? byName.get('body_height') ?? byName.get('stature');
  if (heightMetric) {
    const raw = lastQty(heightMetric);
    if (raw != null && raw > 0) {
      const units = normUnits(heightMetric.units);
      let cm: number;
      if (units.includes('in') && !units.includes('cm')) cm = raw * 2.54;
      else if (units.includes('ft') || units.includes('foot')) cm = raw * 30.48;
      else if (units.includes('m') && raw < 10) cm = raw * 100;
      else cm = raw; // assume cm
      const rounded = Math.round(Math.max(0, cm) * 10) / 10;
      if (rounded > 0) updates.heightCm = rounded;
    }
  }

  // body_mass: HKQuantityTypeIdentifier.bodyMass — kg or lb. Only include if > 0 (empty = no new data)
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

  // body_mass_index: only include if > 0 (empty = no new data)
  const bmiMetric = byName.get('body_mass_index') ?? byName.get('bmi');
  const bmiVal = lastQty(bmiMetric) ?? lastAvg(bmiMetric);
  if (bmiVal != null && bmiVal > 0) updates.bodyMassIndex = Math.round(bmiVal * 10) / 10;

  // body_fat_percentage: only include if > 0 — Apple allows 0 but it's not physiologically realistic; 0 in export = empty/no reading
  const bodyFatMetric = byName.get('body_fat_percentage') ?? byName.get('body_fat') ?? byName.get('bodyFatPercentage');
  const bodyFatVal = lastQty(bodyFatMetric) ?? lastAvg(bodyFatMetric);
  if (bodyFatVal != null && bodyFatVal > 0) {
    const pct = bodyFatVal <= 1 ? bodyFatVal * 100 : bodyFatVal; // 0.22 → 22 or already 22
    const rounded = Math.round(pct * 10) / 10;
    if (rounded > 0) updates.bodyFatPercent = rounded;
  }

  // lean_body_mass: only include if > 0 (empty = no new data)
  const leanMassMetric = byName.get('lean_body_mass') ?? byName.get('leanBodyMass');
  const leanMassVal = lastQty(leanMassMetric) ?? lastAvg(leanMassMetric);
  if (leanMassVal != null && leanMassVal > 0) {
    const units = normUnits(leanMassMetric?.units);
    const kg = units.includes('lb') ? leanMassVal * 0.453592 : leanMassVal;
    const rounded = Math.round(kg * 100) / 100;
    if (rounded > 0) updates.leanBodyMassKg = rounded;
  }

  // heart_rate: HKQuantityTypeIdentifier.heartRate — count/time (bpm)
  const hr = byName.get('heart_rate');
  const bpm = lastAvg(hr);
  if (bpm != null && bpm >= 0) updates.heartRate = Math.round(bpm);

  const restingHr = byName.get('resting_heart_rate');
  const restingBpm = lastAvg(restingHr) ?? lastQty(restingHr);
  if (restingBpm != null && restingBpm >= 0) updates.restingHeartRate = Math.round(restingBpm);

  return updates;
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
      Object.assign(updates, parseHealthAutoExport(body));
    }

    // Flat format (also allow overriding from flat fields if present)
    if (body.steps !== undefined) updates.steps = Math.max(0, Math.floor(parseNumber(body.steps) ?? 0));
    if (body.activeCalories !== undefined) updates.activeCalories = Math.max(0, parseNumber(body.activeCalories) ?? 0);
    if (body.restingCalories !== undefined) updates.restingCalories = Math.max(0, parseNumber(body.restingCalories) ?? 0);
    if (body.totalCalories !== undefined) updates.totalCalories = Math.max(0, parseNumber(body.totalCalories) ?? 0);
    if (body.distanceKm !== undefined) updates.distanceKm = Math.max(0, parseNumber(body.distanceKm) ?? 0);
    if (body.flightsClimbed !== undefined) updates.flightsClimbed = Math.max(0, Math.floor(parseNumber(body.flightsClimbed) ?? 0));
    // Only include body metrics when value > 0 — empty/zero = no new data, don't stamp "just now"
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
    if (body.heartRate !== undefined) updates.heartRate = Math.max(0, Math.floor(parseNumber(body.heartRate) ?? 0));
    if (body.restingHeartRate !== undefined) updates.restingHeartRate = Math.max(0, Math.floor(parseNumber(body.restingHeartRate) ?? 0));
    if (Object.keys(updates).length === 0) {
      console.warn('[Wellness import] No valid fields.', { topLevelKeys: Object.keys(body) });
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    await updateWellnessData(updates);

    if (updates.steps !== undefined) {
      await updateStepsSession(updates.steps);
    }
    if (updates.distanceKm !== undefined) {
      await updateDistanceSession(updates.distanceKm);
    }
    if (updates.flightsClimbed !== undefined) {
      await updateFlightsSession(updates.flightsClimbed);
    }
    if (updates.activeCalories !== undefined) {
      await updateActiveCaloriesSession(updates.activeCalories);
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
