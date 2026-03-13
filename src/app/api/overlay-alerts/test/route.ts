import { NextRequest, NextResponse } from 'next/server';
import { pushTestAlert } from '@/utils/overlay-alerts-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { addToWallet, getWallet } from '@/utils/challenges-storage';
import { verifyRequestAuth } from '@/lib/api-auth';
import { kv } from '@/lib/kv';
import type { OverlayAlertType } from '@/utils/overlay-alerts-storage';

export const dynamic = 'force-dynamic';

const VALID_TYPES: OverlayAlertType[] = ['sub', 'resub', 'giftSub', 'kicks'];

// Mirror the real wallet amounts from alert-handler
const ALERT_WALLET: Record<OverlayAlertType, { amount: number; source: string }> = {
  sub:     { amount: 5,   source: 'SUB' },
  resub:   { amount: 5,   source: 'RESUB' },
  giftSub: { amount: 25,  source: 'GIFT SUB' }, // 5 gifts × $5
  kicks:   { amount: 5,   source: 'KICKS' },     // 500 kicks × $0.01
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

    // Add to wallet if enabled (mirrors what real events do)
    const settings = await kv.get<{ walletEnabled?: boolean }>('overlay_settings');
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
