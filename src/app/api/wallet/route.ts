import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { getWallet, setWalletBalance, addToWallet } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { getLocalCurrencyContext } from '@/utils/local-currency';

export const dynamic = 'force-dynamic';

/** GET /api/wallet — public read.
 *  Uses Vercel's x-vercel-ip-country header (always available, no RTIRL needed)
 *  to detect the streamer's current country and keep local currency up to date
 *  when travelling. Runs as a background task so response is instant. */
export async function GET(request: NextRequest) {
  const state = await getWallet();
  // Vercel sets this header on every request — reliable even without RTIRL
  const ipCountry = request.headers.get('x-vercel-ip-country')?.toUpperCase() ?? undefined;
  void (async () => {
    const localCtx = await getLocalCurrencyContext(ipCountry);
    // Update whenever currency is missing OR the detected currency has changed (e.g. travelling)
    if (localCtx && (localCtx.currency !== state.localCurrency || !state.localRate)) {
      await setWalletBalance(state.balance, { localCurrency: localCtx.currency, localRate: localCtx.rate });
      void broadcastChallenges().catch(() => {});
    }
  })().catch(() => {});
  return NextResponse.json(state);
}

/** POST /api/wallet — set or adjust wallet balance
 *  Body: { action: 'set' | 'add', amount: number }
 */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json() as { action?: string; amount?: unknown };
    const action = body.action ?? 'set';
    const amount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? ''));
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    const state = action === 'add' ? await addToWallet(amount) : await setWalletBalance(amount);
    void broadcastChallenges().catch(() => {});
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ error: 'Wallet update failed' }, { status: 500 });
  }
}
