import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { getWallet, setWalletBalance, addToWallet, setTotalSpent } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { getLocalCurrencyContext } from '@/utils/local-currency';
import { getPersistentLocation } from '@/utils/location-cache';

export const dynamic = 'force-dynamic';

/** GET /api/wallet — public read.
 *  Currency is derived solely from GPS-geocoded country (RTIRL).
 *  IP geolocation is intentionally not used — eSIMs in Asia route through other
 *  countries (e.g. SG/HK), which would set the wrong currency.
 *  Runs as a background task so response is instant. */
export async function GET() {
  const state = await getWallet();
  void (async () => {
    const persistent = await getPersistentLocation();
    const gpsCountry = persistent?.location?.countryCode?.toUpperCase();
    if (!gpsCountry) return;
    const localCtx = await getLocalCurrencyContext(gpsCountry);
    // Update whenever currency is missing OR GPS-derived currency has changed (e.g. travelling)
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

    if (action === 'set_spent') {
      const spent = Number.isFinite(amount) ? amount : 0;
      await setTotalSpent(spent);
      void broadcastChallenges().catch(() => {});
      const state = await getWallet();
      return NextResponse.json(state);
    }

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
