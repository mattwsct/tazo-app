/**
 * PATCH: Admin-only manual update of wellness data.
 * Use to add missing values (e.g. weight) before Health Auto Export sends them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';
import { updateWellnessData } from '@/utils/wellness-storage';

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
    if (body.distanceKm !== undefined) {
      const v = parseNumber(body.distanceKm);
      if (v !== undefined) updates.distanceKm = Math.max(0, v);
    }
    if (body.heightCm !== undefined) {
      const v = parseNumber(body.heightCm);
      if (v !== undefined) updates.heightCm = Math.max(0, v);
    }
    if (body.weightKg !== undefined) {
      const v = parseNumber(body.weightKg);
      if (v !== undefined) updates.weightKg = Math.max(0, v);
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid wellness fields provided' }, { status: 400 });
    }

    await updateWellnessData(updates, { fromManualEntry: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Wellness update failed:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
