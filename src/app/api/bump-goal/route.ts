/**
 * POST /api/bump-goal
 * Bump the sub or kicks goal target after the celebration window ends.
 * Called by the overlay when celebration period has passed.
 * No auth required (overlay is public).
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getStreamGoals } from '@/utils/stream-goals-storage';
import { getGoalCelebration, bumpGoalTarget, shouldBump } from '@/utils/stream-goals-celebration';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const type = (body.type ?? request.nextUrl.searchParams.get('type')) as string;
    if (type !== 'subs' && type !== 'kicks') {
      return NextResponse.json({ error: 'Invalid type. Use subs or kicks' }, { status: 400 });
    }

    const [goals, celebration, settings] = await Promise.all([
      getStreamGoals(),
      getGoalCelebration(),
      kv.get<Record<string, unknown>>('overlay_settings'),
    ]);

    const merged = mergeSettingsWithDefaults(settings ?? {});
    const target = type === 'subs'
      ? (merged.subGoalTarget ?? DEFAULT_OVERLAY_SETTINGS.subGoalTarget ?? 10)
      : (merged.kicksGoalTarget ?? DEFAULT_OVERLAY_SETTINGS.kicksGoalTarget ?? 1000);
    const increment = type === 'subs'
      ? (merged.subGoalIncrement ?? DEFAULT_OVERLAY_SETTINGS.subGoalIncrement ?? 10)
      : (merged.kicksGoalIncrement ?? DEFAULT_OVERLAY_SETTINGS.kicksGoalIncrement ?? 1000);

    const count = type === 'subs' ? goals.subs : goals.kicks;
    const until = type === 'subs' ? celebration.subsUntil : celebration.kicksUntil;

    if (!shouldBump(type, until, count, target)) {
      return NextResponse.json({ bumped: false, reason: 'celebration not ended or goal not reached' }, { status: 200 });
    }

    const newTarget = await bumpGoalTarget(type, target, increment);
    return NextResponse.json({ bumped: true, newTarget });
  } catch (e) {
    console.warn('[bump-goal]', e);
    return NextResponse.json({ error: 'Failed to bump goal' }, { status: 500 });
  }
}
