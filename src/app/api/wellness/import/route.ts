/**
 * POST: Receive wellness data from Health Auto Export (or similar).
 * Requires X-Wellness-Secret header to match WELLNESS_IMPORT_SECRET env.
 * Accepts: steps, activeCalories, restingCalories, sleepHours, etc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateWellnessData, updateStepsSession } from '@/utils/wellness-storage';
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

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-wellness-secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const expected = process.env.WELLNESS_IMPORT_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'preview') {
      console.log('[Wellness import] Body keys:', Object.keys(body), 'sample:', JSON.stringify(body).slice(0, 500));
    }
    const updates: Partial<WellnessData> = {};

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
    if (body.heartRate !== undefined) updates.heartRate = Math.max(0, Math.floor(parseNumber(body.heartRate) ?? 0));
    if (body.restingHeartRate !== undefined) updates.restingHeartRate = Math.max(0, Math.floor(parseNumber(body.restingHeartRate) ?? 0));
    if (body.hrv !== undefined) updates.hrv = Math.max(0, parseNumber(body.hrv) ?? 0);

    if (Object.keys(updates).length === 0) {
      console.warn('[Wellness import] No valid fields. Received:', JSON.stringify(body));
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    await updateWellnessData(updates);

    if (updates.steps !== undefined) {
      await updateStepsSession(updates.steps);
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
