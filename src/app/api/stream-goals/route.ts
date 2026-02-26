/**
 * GET: Return current subs and kicks.
 * PATCH: Manually set subs and/or kicks (admin auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getStreamGoals, setStreamGoals } from '@/utils/stream-goals-storage';
import { setGoalCelebrationIfNeeded } from '@/utils/stream-goals-celebration';
import { broadcastAlertsAndLeaderboard } from '@/lib/alerts-broadcast';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const goals = await getStreamGoals();
    return NextResponse.json(goals);
  } catch (err) {
    console.warn('[stream-goals] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { subs?: number; kicks?: number };
    if (body.subs === undefined && body.kicks === undefined) {
      return NextResponse.json({ error: 'Provide subs and/or kicks' }, { status: 400 });
    }
    await setStreamGoals(body);
    void broadcastAlertsAndLeaderboard();
    const goals = await getStreamGoals();

    const settings = await kv.get<Record<string, unknown>>('overlay_settings');
    if (goals.subs > 0) {
      const subTarget = (settings?.subGoalTarget as number) ?? DEFAULT_OVERLAY_SETTINGS.subGoalTarget!;
      if (goals.subs >= subTarget) {
        await setGoalCelebrationIfNeeded('subs', goals.subs, subTarget);
      }
    }
    if (goals.kicks > 0) {
      const kicksTarget = (settings?.kicksGoalTarget as number) ?? DEFAULT_OVERLAY_SETTINGS.kicksGoalTarget!;
      if (goals.kicks >= kicksTarget) {
        await setGoalCelebrationIfNeeded('kicks', goals.kicks, kicksTarget);
      }
    }

    return NextResponse.json(goals);
  } catch (err) {
    console.warn('[stream-goals] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
