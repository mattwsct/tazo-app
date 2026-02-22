/**
 * PATCH: Admin-only manual update of wellness data.
 * Use to add missing values (e.g. weight) before Health Auto Export sends them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';
import {
  updateWellnessData,
  updateStepsSession,
  updateDistanceSession,
  updateFlightsSession,
} from '@/utils/wellness-storage';

export const dynamic = 'force-dynamic';

function parseNumber(val: unknown): number | undefined {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export async function PATCH(request: NextRequest) {
  const auth = await verifyAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, number | string> = {};

    if (body.steps !== undefined) {
      const v = parseNumber(body.steps);
      if (v !== undefined) updates.steps = Math.max(0, Math.floor(v));
    }
    if (body.activeCalories !== undefined) {
      const v = parseNumber(body.activeCalories);
      if (v !== undefined) updates.activeCalories = Math.max(0, v);
    }
    if (body.restingCalories !== undefined) {
      const v = parseNumber(body.restingCalories);
      if (v !== undefined) updates.restingCalories = Math.max(0, v);
    }
    if (body.totalCalories !== undefined) {
      const v = parseNumber(body.totalCalories);
      if (v !== undefined) updates.totalCalories = Math.max(0, v);
    }
    if (body.distanceKm !== undefined) {
      const v = parseNumber(body.distanceKm);
      if (v !== undefined) updates.distanceKm = Math.max(0, v);
    }
    if (body.flightsClimbed !== undefined) {
      const v = parseNumber(body.flightsClimbed);
      if (v !== undefined) updates.flightsClimbed = Math.max(0, Math.floor(v));
    }
    if (body.heightCm !== undefined) {
      const v = parseNumber(body.heightCm);
      if (v !== undefined) updates.heightCm = Math.max(0, v);
    }
    if (body.weightKg !== undefined) {
      const v = parseNumber(body.weightKg);
      if (v !== undefined) updates.weightKg = Math.max(0, v);
    }
    if (body.bodyMassIndex !== undefined) {
      const v = parseNumber(body.bodyMassIndex);
      if (v !== undefined) updates.bodyMassIndex = Math.max(0, v);
    }
    if (body.bodyFatPercent !== undefined) {
      const v = parseNumber(body.bodyFatPercent);
      if (v !== undefined) updates.bodyFatPercent = Math.max(0, Math.min(100, v));
    }
    if (body.leanBodyMassKg !== undefined) {
      const v = parseNumber(body.leanBodyMassKg);
      if (v !== undefined) updates.leanBodyMassKg = Math.max(0, v);
    }
    if (body.heartRate !== undefined) {
      const v = parseNumber(body.heartRate);
      if (v !== undefined) updates.heartRate = Math.max(0, Math.floor(v));
    }
    if (body.restingHeartRate !== undefined) {
      const v = parseNumber(body.restingHeartRate);
      if (v !== undefined) updates.restingHeartRate = Math.max(0, Math.floor(v));
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    await updateWellnessData(updates, { fromManualEntry: true });
    // Only session metrics need session updates; weight/BMI are stored directly
    if (updates.steps !== undefined) await updateStepsSession(updates.steps as number);
    if (updates.distanceKm !== undefined) await updateDistanceSession(updates.distanceKm as number);
    if (updates.flightsClimbed !== undefined) await updateFlightsSession(updates.flightsClimbed as number);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Wellness update failed:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
