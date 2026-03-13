/**
 * GET: Return current subs and kicks.
 * PATCH: Manually set subs and/or kicks (admin auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { getStreamGoals, setStreamGoals } from '@/utils/stream-goals-storage';
import { verifyRequestAuth } from '@/lib/api-auth';
import { bumpGoalTarget } from '@/utils/stream-goals-celebration';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { Logger } from '@/lib/logger';

const goalLogger = new Logger('STREAM-GOALS');

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
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { subs?: number; kicks?: number };
    goalLogger.info('[stream-goals] PATCH body', {
      subs: body.subs,
      kicks: body.kicks,
      origin: request.headers.get('origin') ?? null,
      host: request.headers.get('host') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });
    if (body.subs === undefined && body.kicks === undefined) {
      return NextResponse.json({ error: 'Provide subs and/or kicks' }, { status: 400 });
    }
    await setStreamGoals(body);
    void broadcastChallenges();
    const goals = await getStreamGoals();

    const settings = await kv.get<Record<string, unknown>>('overlay_settings');
    let subTarget = (settings?.subGoalTarget as number) ?? DEFAULT_OVERLAY_SETTINGS.subGoalTarget!;
    const subIncrement = (settings?.subGoalIncrement as number) ?? DEFAULT_OVERLAY_SETTINGS.subGoalIncrement!;
    let kicksTarget = (settings?.kicksGoalTarget as number) ?? DEFAULT_OVERLAY_SETTINGS.kicksGoalTarget!;
    const kicksIncrement = (settings?.kicksGoalIncrement as number) ?? DEFAULT_OVERLAY_SETTINGS.kicksGoalIncrement!;
    // Bump targets immediately if admin set goals past the current target
    if (body.subs !== undefined && goals.subs > 0 && goals.subs >= subTarget) {
      subTarget = await bumpGoalTarget('subs', subTarget, subIncrement, goals.subs);
    }
    if (body.kicks !== undefined && goals.kicks > 0 && goals.kicks >= kicksTarget) {
      kicksTarget = await bumpGoalTarget('kicks', kicksTarget, kicksIncrement, goals.kicks);
    }

    if (settings?.showSubGoal || settings?.showKicksGoal) {
      void updateKickTitleGoals(goals.subs, subTarget, goals.kicks, kicksTarget).catch(() => {});
    }

    goalLogger.info('[stream-goals] PATCH result', { goals, subTarget, kicksTarget });

    return NextResponse.json(goals);
  } catch (err) {
    console.warn('[stream-goals] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
