import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getKickEventSubscriptions } from '@/lib/kick-api';

const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stored = await kv.get<{ access_token: string }>(KICK_TOKENS_KEY);
  if (!stored?.access_token) {
    return NextResponse.json({
      connected: false,
      subscriptions: [],
    });
  }

  try {
    const subscriptions = await getKickEventSubscriptions(stored.access_token);
    return NextResponse.json({
      connected: true,
      subscriptions,
    });
  } catch {
    return NextResponse.json({
      connected: true,
      subscriptions: [],
      warning: 'Could not fetch subscriptions',
    });
  }
}
