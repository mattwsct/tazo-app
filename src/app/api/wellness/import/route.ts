/**
 * POST: Receive wellness data from Health Auto Export (or similar).
 * Requires X-Wellness-Secret header to match WELLNESS_IMPORT_SECRET env.
 * Supports two formats:
 * 1. Flat: { steps, distanceKm, heightCm, weightKg, ... }
 * 2. Health Auto Export: { data: { metrics: [{ name, units, data: [{ qty, date, ... }] }] } }
 *
 * Health Auto Export should be configured to send TODAY'S CUMULATIVE TOTALS (not "Since last sync").
 * The server calculates deltas as (newTotal - lastKnown), recovering late Apple Watch data automatically.
 *
 * Tracked metrics: step_count, walking_running_distance, height, body_mass (weight). Heart rate is from Pulsoid only (not stored in wellness).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { kv } from '@/lib/kv';
import { updateWellnessData } from '@/utils/wellness-storage';
import type { WellnessData } from '@/utils/wellness-storage';
import { checkWellnessMilestonesAndSendChat } from '@/lib/wellness-milestone-chat';

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

  // step_count
  const stepCount = byName.get('step_count');
  if (stepCount) {
    const total = Math.round(sumQty(stepCount));
    if (total >= 0) updates.steps = total;
  }

  // walking_running_distance
  const walkingDist = byName.get('walking_running_distance');
  if (walkingDist) {
    updates.distanceKm = Math.max(0, Math.round(distanceToKm(sumQty(walkingDist), walkingDist.units) * 1000) / 1000);
  }

  // Body metrics: height, weight only
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
        parsed.updates.distanceKm != null && `dist=${parsed.updates.distanceKm}km`,
      ].filter(Boolean).join(' ');
      console.log(`[Wellness] HAE received=[${metricNames.join(',')}] ${parts || '(no tracked metrics)'}`);
    }

    // Flat format
    if (body.steps !== undefined) updates.steps = Math.max(0, Math.floor(parseNumber(body.steps) ?? 0));
    if (body.distanceKm !== undefined) updates.distanceKm = Math.max(0, parseNumber(body.distanceKm) ?? 0);
    const heightVal = body.heightCm !== undefined ? Math.max(0, parseNumber(body.heightCm) ?? 0) : undefined;
    if (heightVal != null && heightVal > 0) updates.heightCm = heightVal;
    const weightVal = body.weightKg !== undefined ? Math.max(0, parseNumber(body.weightKg) ?? 0) : undefined;
    if (weightVal != null && weightVal > 0) updates.weightKg = weightVal;

    if (Object.keys(updates).length === 0) {
      console.warn('[Wellness] No valid fields.', { topLevelKeys: Object.keys(body) });
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
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
    // When stream is live, check milestones immediately and post chat messages if any crossed
    void checkWellnessMilestonesAndSendChat().then((n) => {
      if (n > 0) console.log(`[Wellness] Milestone chat sent=${n} after import`);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Wellness import failed:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
