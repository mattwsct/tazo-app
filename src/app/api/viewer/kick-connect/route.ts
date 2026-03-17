import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { generateCodeVerifier, generateCodeChallenge } from '@/lib/kick-api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const clientId = process.env.KICK_CLIENT_ID ?? '';
  const appUrl = (process.env.APP_URL ?? 'https://tazo.wtf').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/viewer/kick-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user:read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://id.kick.com/oauth/authorize?${params.toString()}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('viewer_kick_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });
  // Store code_verifier for PKCE exchange in callback
  response.cookies.set('viewer_kick_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
