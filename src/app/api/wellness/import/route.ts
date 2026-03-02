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
import { createHash } from 'crypto';
import { kv } from '@/lib/kv';
import { updateWellnessData, updateStepsSession, updateDistanceSession, updateFlightsSession, updateActiveCaloriesSession, getWellnessData, getWellnessSessionStart } from '@/utils/wellness-storage';
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

function parseHealthAutoExport(body: Record<string, unknown>, onlyAfterMs?: number | null): {
  updates: Partial<WellnessData>;
  sessionDeltas: { steps?: number; distanceKm?: number; flightsClimbed?: number; activeCalories?: number };
} {
  const data = body.data as { metrics?: HealthMetric[] } | undefined;
  const metrics = data?.metrics;
  const emptyResult = { updates: {} as Partial<WellnessData>, sessionDeltas: {} };
  if (!Array.isArray(metrics)) return emptyResult;

  const byName = new Map<string, HealthMetric>();
  for (const m of metrics) {
    if (m?.name) byName.set(m.name, m);
  }

  const updates: Partial<WellnessData> = {};

  // Sum all data points (no timestamp filter) — used for current wellness display values
  const sumQty = (m: HealthMetric | undefined): number => {
    if (!m?.data || !Array.isArray(m.data)) return 0;
    return m.data.reduce((s, d) => s + (typeof d.qty === 'number' ? d.qty : 0), 0);
  };

  // Sum only data points timestamped after session start — used for session accumulators
  // If no session start is known, fall back to summing all (safe for first-ever import)
  const sumQtySession = (m: HealthMetric | undefined): number => {
    if (!m?.data || !Array.isArray(m.data)) return 0;
    if (onlyAfterMs == null) return sumQty(m);
    return m.data.reduce((s, d) => {
      if (typeof d.qty !== 'number') return s;
      if (typeof d.date === 'string') {
        const ts = Date.parse(d.date);
        if (!Number.isNaN(ts) && ts < onlyAfterMs) return s; // skip pre-session data point
      }
      return s + d.qty;
    }, 0);
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

  // Session deltas: same metrics but only counting data points after session start
  const sessionDeltas: { steps?: number; distanceKm?: number; flightsClimbed?: number; activeCalories?: number } = {};

  // step_count: HKQuantityTypeIdentifier.stepCount — count (no unit conversion)
  const stepCount = byName.get('step_count');
  if (stepCount) {
    const total = Math.round(sumQty(stepCount));
    if (total >= 0) updates.steps = total;
    sessionDeltas.steps = Math.round(sumQtySession(stepCount));
  }

  // active_energy / activeEnergyBurned: HKQuantityTypeIdentifier.activeEnergyBurned — kJ or kcal (user pref)
  const activeEnergy = byName.get('active_energy') ?? byName.get('activeEnergyBurned') ?? byName.get('active_energy_burned');
  if (activeEnergy) {
    const raw = sumQty(activeEnergy);
    updates.activeCalories = Math.max(0, Math.round(energyToKcal(raw, activeEnergy.units)));
    sessionDeltas.activeCalories = Math.max(0, Math.round(energyToKcal(sumQtySession(activeEnergy), activeEnergy.units)));
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
    sessionDeltas.distanceKm = Math.max(0, Math.round(distanceToKm(sumQtySession(walkingDist), walkingDist.units) * 1000) / 1000);
  }

  // flights_climbed: HKQuantityTypeIdentifier.flightsClimbed — count
  const flights = byName.get('flights_climbed');
  if (flights) {
    const total = Math.max(0, Math.round(sumQty(flights)));
    updates.flightsClimbed = total;
    sessionDeltas.flightsClimbed = Math.max(0, Math.round(sumQtySession(flights)));
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

  // heart_rate: HKQuantityTypeIdentifier.heartRate — count/time (bpm). Clamped to 0–300.
  const hr = byName.get('heart_rate');
  const bpm = lastAvg(hr);
  if (bpm != null && bpm >= 0 && bpm <= 300) updates.heartRate = Math.round(bpm);

  const restingHr = byName.get('resting_heart_rate');
  const restingBpm = lastAvg(restingHr) ?? lastQty(restingHr);
  if (restingBpm != null && restingBpm >= 0 && restingBpm <= 300) updates.restingHeartRate = Math.round(restingBpm);

  return { updates, sessionDeltas };
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
    // Session-filtered deltas — only data points timestamped after stream start
    let sessionOverrides: { steps?: number; distanceKm?: number; flightsClimbed?: number; activeCalories?: number } | null = null;

    // Fetch session start time once (used to filter pre-stream data from session counters)
    const sessionStartAt = await getWellnessSessionStart();

    // Health Auto Export format: { data: { metrics: [...] } }
    if (body.data && typeof body.data === 'object' && (body.data as { metrics?: unknown }).metrics) {
      const data = body.data as { metrics?: Array<{ name?: string }> };
      const metricNames = (data.metrics ?? []).map(m => m?.name).filter(Boolean) as string[];
      const parsed = parseHealthAutoExport(body, sessionStartAt);
      Object.assign(updates, parsed.updates);
      sessionOverrides = parsed.sessionDeltas;
      // Log if any session values were filtered
      const filteredSteps = (parsed.updates.steps ?? 0) - (parsed.sessionDeltas.steps ?? parsed.updates.steps ?? 0);
      const filteredDist = (parsed.updates.distanceKm ?? 0) - (parsed.sessionDeltas.distanceKm ?? parsed.updates.distanceKm ?? 0);
      console.log('[Wellness import] Health Auto Export:', {
        received: metricNames,
        parsed: parsed.updates,
        ...(filteredSteps > 0 || filteredDist > 0 ? { preStreamFiltered: { steps: filteredSteps, distanceKm: filteredDist } } : {}),
      });
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
    if (body.heartRate !== undefined) updates.heartRate = Math.min(300, Math.max(0, Math.floor(parseNumber(body.heartRate) ?? 0)));
    if (body.restingHeartRate !== undefined) updates.restingHeartRate = Math.min(300, Math.max(0, Math.floor(parseNumber(body.restingHeartRate) ?? 0)));
    if (Object.keys(updates).length === 0) {
      console.warn('[Wellness import] No valid fields.', { topLevelKeys: Object.keys(body) });
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    // Auto-calculate BMI from weight + height when BMI wasn't supplied directly
    if (updates.weightKg && !updates.bodyMassIndex) {
      const heightCm = updates.heightCm ?? (await getWellnessData())?.heightCm;
      if (heightCm && heightCm > 0) {
        const heightM = heightCm / 100;
        updates.bodyMassIndex = Math.round((updates.weightKg / (heightM * heightM)) * 10) / 10;
        console.log('[Wellness import] BMI auto-calculated:', { weightKg: updates.weightKg, heightCm, bmi: updates.bodyMassIndex });
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
      console.log('[Wellness import] Duplicate payload ignored (within dedup window).', { hash: dedupHash });
      return NextResponse.json({ ok: true, skipped: true });
    }
    await kv.set(dedupKey, 1, { ex: IMPORT_DEDUP_TTL_SEC });

    console.log('[Wellness import] Saving:', updates);
    await updateWellnessData(updates);

    // Use session-filtered deltas for accumulators (excludes pre-stream data points)
    const sessionSteps = sessionOverrides?.steps ?? updates.steps;
    const sessionDist = sessionOverrides?.distanceKm ?? updates.distanceKm;
    const sessionFlights = sessionOverrides?.flightsClimbed ?? updates.flightsClimbed;
    const sessionCals = sessionOverrides?.activeCalories ?? updates.activeCalories;

    if (sessionSteps !== undefined) {
      await updateStepsSession(sessionSteps);
    }
    if (sessionDist !== undefined) {
      await updateDistanceSession(sessionDist);
    }
    if (sessionFlights !== undefined) {
      await updateFlightsSession(sessionFlights);
    }
    if (sessionCals !== undefined) {
      await updateActiveCaloriesSession(sessionCals);
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
