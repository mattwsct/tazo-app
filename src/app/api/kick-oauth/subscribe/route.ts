import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  subscribeToKickEvents,
  refreshKickTokens,
} from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';

const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

/**
 * POST /api/kick-oauth/subscribe
 * Re-subscribe to Kick events. Requires admin auth cookie.
 * Call this if webhooks stop working (Kick unsubscribes after repeated failures).
 */
export async function POST(request: NextRequest) {
  // Check admin auth
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) {
    return NextResponse.json({
      error: 'Not connected. Visit /api/kick-oauth/authorize to connect.',
    }, { status: 400 });
  }

  let accessToken = stored.access_token;
  const now = Date.now();
  if (stored.expires_at - 60 * 1000 < now) {
    try {
      const tokens = await refreshKickTokens(stored.refresh_token);
      accessToken = tokens.access_token;
      await kv.set(KICK_TOKENS_KEY, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: now + tokens.expires_in * 1000,
        scope: tokens.scope,
      });
    } catch {
      return NextResponse.json({
        error: 'Token refresh failed. Re-connect via /api/kick-oauth/authorize',
      }, { status: 401 });
    }
  }

  try {
    const result = await subscribeToKickEvents(accessToken);
    return NextResponse.json({
      success: true,
      subscriptions: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Subscribe failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
