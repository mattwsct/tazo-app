/**
 * GET/POST poll settings. Requires auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPollSettings, setPollSettings } from '@/lib/poll-store';
import type { PollSettings } from '@/types/poll';

export const dynamic = 'force-dynamic';

async function requireAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get('auth-token')?.value === 'authenticated';
}

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getPollSettings();
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Partial<PollSettings>;
    const updates: Partial<PollSettings> = {};
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (typeof body.durationSeconds === 'number' && body.durationSeconds >= 5 && body.durationSeconds <= 300) {
      updates.durationSeconds = body.durationSeconds;
    }
    if (typeof body.everyoneCanStart === 'boolean') updates.everyoneCanStart = body.everyoneCanStart;
    if (typeof body.modsCanStart === 'boolean') updates.modsCanStart = body.modsCanStart;
    if (typeof body.vipsCanStart === 'boolean') updates.vipsCanStart = body.vipsCanStart;
    if (typeof body.ogsCanStart === 'boolean') updates.ogsCanStart = body.ogsCanStart;
    if (typeof body.subsCanStart === 'boolean') updates.subsCanStart = body.subsCanStart;
    if (typeof body.maxQueuedPolls === 'number' && body.maxQueuedPolls >= 1 && body.maxQueuedPolls <= 20) {
      updates.maxQueuedPolls = body.maxQueuedPolls;
    }
    if (typeof body.winnerDisplaySeconds === 'number' && body.winnerDisplaySeconds >= 1 && body.winnerDisplaySeconds <= 60) {
      updates.winnerDisplaySeconds = body.winnerDisplaySeconds;
    }
    if (typeof body.autoStartPollsEnabled === 'boolean') updates.autoStartPollsEnabled = body.autoStartPollsEnabled;
    if (typeof body.chatIdleMinutes === 'number' && body.chatIdleMinutes >= 1 && body.chatIdleMinutes <= 30) {
      updates.chatIdleMinutes = body.chatIdleMinutes;
    }
    await setPollSettings(updates);
    const settings = await getPollSettings();
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
