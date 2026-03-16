import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { getWallet, setWalletBalance, addToWallet } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { getLocalCurrencyContext } from '@/utils/local-currency';
import { getPersistentLocation } from '@/utils/location-cache';

export const dynamic = 'force-dynamic';

/** GET /api/wallet — public read.
 *  Prefers GPS-geocoded country (RTIRL) over IP geolocation — IP can misreport
 *  country due to regional internet routing (e.g. Thai traffic routed via HK).
 *  Falls back to Vercel's x-vercel-ip-country when no GPS location is available.
 *  Runs as a background task so response is instant. */
export async function GET(request: NextRequest) {
  const state = await getWallet();
  // IP country is a fallback only — GPS geocoded location is more accurate for a travelling streamer
  const ipCountry = request.headers.get('x-vercel-ip-country')?.toUpperCase() ?? undefined;
  void (async () => {
    const persistent = await getPersistentLocation();
    const gpsCountry = persistent?.location?.countryCode?.toUpperCase() ?? undefined;
    const localCtx = await getLocalCurrencyContext(gpsCountry ?? ipCountry);
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
