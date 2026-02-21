/**
 * GET: Return current subs and kicks.
 * PATCH: Manually set subs and/or kicks (admin auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStreamGoals, setStreamGoals } from '@/utils/stream-goals-storage';
import { broadcastAlertsAndLeaderboard } from '@/lib/alerts-broadcast';

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
    return NextResponse.json(goals);
  } catch (err) {
    console.warn('[stream-goals] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
