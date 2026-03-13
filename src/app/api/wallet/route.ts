import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { getWallet, setWalletBalance, addToWallet } from '@/utils/challenges-storage';

export const dynamic = 'force-dynamic';

/** GET /api/wallet — public read */
export async function GET() {
  const state = await getWallet();
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
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ error: 'Wallet update failed' }, { status: 500 });
  }
}
