import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  KICK_OAUTH_BASE,
  KICK_SCOPES,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@/lib/kick-api';

const PKCE_STATE_KEY_PREFIX = 'kick_oauth_pkce:';
const PKCE_TTL = 600; // 10 minutes

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const clientId = process.env.KICK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Kick OAuth not configured' }, { status: 500 });
  }

  const baseUrl =
    process.env.KICK_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    request.nextUrl.origin;
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/kick-oauth/callback`;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  await kv.set(`${PKCE_STATE_KEY_PREFIX}${state}`, codeVerifier, { ex: PKCE_TTL });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: KICK_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(`${KICK_OAUTH_BASE}/oauth/authorize?${params.toString()}`);
}
