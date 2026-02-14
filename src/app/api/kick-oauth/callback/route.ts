import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  exchangeCodeForTokens,
  subscribeToKickEvents,
} from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';

const PKCE_STATE_KEY_PREFIX = 'kick_oauth_pkce:';
const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const baseUrl =
    process.env.KICK_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    request.nextUrl.origin;
  const base = baseUrl.replace(/\/$/, '');
  const redirectUri = `${base}/api/kick-oauth/callback`;
  const adminUrl = base;

  if (error) {
    console.error('[Kick OAuth] Error:', error, searchParams.get('error_description'));
    return NextResponse.redirect(`${adminUrl}?kick_oauth=error&error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${adminUrl}?kick_oauth=error&error=missing_params`);
  }

  const codeVerifier = await kv.get<string>(`${PKCE_STATE_KEY_PREFIX}${state}`);
  await kv.del(`${PKCE_STATE_KEY_PREFIX}${state}`);

  if (!codeVerifier) {
    return NextResponse.redirect(`${adminUrl}?kick_oauth=error&error=invalid_state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    const stored: StoredKickTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
    };
    await kv.set(KICK_TOKENS_KEY, stored);

    // Subscribe to events (webhook URL is configured in Kick app settings)
    try {
      await subscribeToKickEvents(tokens.access_token);
    } catch (subErr) {
      console.warn('[Kick OAuth] Event subscription failed (may already be subscribed):', subErr);
    }

    return NextResponse.redirect(`${adminUrl}?kick_oauth=success`);
  } catch (err) {
    console.error('[Kick OAuth] Token exchange failed:', err);
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    return NextResponse.redirect(`${adminUrl}?kick_oauth=error&error=${encodeURIComponent(msg)}`);
  }
}
