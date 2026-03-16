import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
import { OverlayLogger } from '@/lib/logger';
import type { OverlayTimerState } from '@/types/timer';
import { getOverlayTimer, setOverlayTimer } from '@/utils/overlay-timer-storage';

export const dynamic = 'force-dynamic';

async function handleGet(): Promise<NextResponse> {
  try {
    logKVUsage('read');
    const timer = await getOverlayTimer();
    return NextResponse.json(timer ?? null, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    OverlayLogger.error('Failed to load timer state', error);
    return NextResponse.json({ error: 'Failed to load timer' }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { minutes?: unknown; title?: unknown };
    const minutesRaw = typeof body.minutes === 'string' ? parseFloat(body.minutes) : (body.minutes as number | undefined);
    const minutes = Number.isFinite(minutesRaw as number) ? Number(minutesRaw) : NaN;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return NextResponse.json(
        { error: 'minutes must be a positive number' },
        { status: 400 },
      );
    }

    // Clamp to a sane maximum to avoid absurd durations.
    const clampedMinutes = Math.min(minutes, 12 * 60);
    const now = Date.now();
    const endsAt = now + clampedMinutes * 60_000;
    const title = typeof body.title === 'string' ? body.title.trim() || undefined : undefined;

    const state: OverlayTimerState = {
      createdAt: now,
      endsAt,
      title,
    };

    await setOverlayTimer(state);
    logKVUsage('write');

    return NextResponse.json(state);
  } catch (error) {
    OverlayLogger.error('Failed to save timer', error);
    return NextResponse.json({ error: 'Failed to save timer' }, { status: 500 });
  }
}

async function handleDelete(): Promise<NextResponse> {
  try {
    await setOverlayTimer(null);
    logKVUsage('write');
    return NextResponse.json({ ok: true });
  } catch (error) {
    OverlayLogger.error('Failed to clear timer', error);
    return NextResponse.json({ error: 'Failed to clear timer' }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Public read-only access is safe: overlay & admin both need to see timer state.
  return handleGet();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) {
    OverlayLogger.warn('Unauthenticated access attempt to POST /api/timer');
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return handlePost(request);
}

export async function DELETE(): Promise<NextResponse> {
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) {
    OverlayLogger.warn('Unauthenticated access attempt to DELETE /api/timer');
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return handleDelete();
}

