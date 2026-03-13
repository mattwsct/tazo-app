import { NextRequest, NextResponse } from 'next/server';
import { pushTestAlert } from '@/utils/overlay-alerts-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { addToWallet } from '@/utils/challenges-storage';
import { addStreamGoalSubs, addStreamGoalKicks } from '@/utils/stream-goals-storage';
import { handleSubGoalMilestone, handleKicksGoalMilestone } from '@/app/api/webhooks/kick/handlers/alert-handler';
import { verifyRequestAuth } from '@/lib/api-auth';
import { kv } from '@/lib/kv';
import type { OverlayAlertType } from '@/utils/overlay-alerts-storage';

export const dynamic = 'force-dynamic';

const VALID_TYPES: OverlayAlertType[] = ['sub', 'resub', 'giftSub', 'kicks'];

// Mirror the real wallet amounts from alert-handler
const ALERT_WALLET: Record<OverlayAlertType, { amount: number; source: string }> = {
  sub:     { amount: 5,   source: 'SUB' },
  resub:   { amount: 5,   source: 'RESUB' },
  giftSub: { amount: 25,  source: '5 GIFT SUB' },
  kicks:   { amount: 5,   source: '500 KICKS' },
};

export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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

    // Increment stream goals + fire milestone logic (mirrors what real events do)
    const settings = await kv.get<Record<string, unknown>>('overlay_settings');
    if (type === 'sub' || type === 'resub') {
      await addStreamGoalSubs(1);
      await handleSubGoalMilestone(1, settings);
    } else if (type === 'giftSub') {
      await addStreamGoalSubs(5);
      await handleSubGoalMilestone(5, settings);
    } else if (type === 'kicks') {
      await addStreamGoalKicks(500);
      await handleKicksGoalMilestone(500, settings);
    }

    // Add to wallet if enabled (mirrors what real events do)
    if (settings?.walletEnabled) {
      const { amount, source } = ALERT_WALLET[type];
      await addToWallet(amount, { source });
    }

    void broadcastChallenges();
    return NextResponse.json({ ok: true, type });
  } catch (e) {
    console.warn('[OverlayAlerts Test]', e);
    return NextResponse.json({ error: 'Failed to push test alert' }, { status: 500 });
  }
}
