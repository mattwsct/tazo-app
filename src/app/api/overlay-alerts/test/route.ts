import { NextRequest, NextResponse } from 'next/server';
import { pushTestAlert } from '@/utils/overlay-alerts-storage';
import { broadcastAlertsAndLeaderboard } from '@/lib/alerts-broadcast';
import type { OverlayAlertType } from '@/utils/overlay-alerts-storage';

export const dynamic = 'force-dynamic';

const VALID_TYPES: OverlayAlertType[] = ['sub', 'resub', 'giftSub', 'kicks'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = String(body.type ?? '').trim() as OverlayAlertType;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Use: sub, resub, giftSub, kicks' },
        { status: 400 }
      );
    }
    await pushTestAlert(type);
    void broadcastAlertsAndLeaderboard();
    return NextResponse.json({ ok: true, type });
  } catch (e) {
    console.warn('[OverlayAlerts Test]', e);
    return NextResponse.json({ error: 'Failed to push test alert' }, { status: 500 });
  }
}
