import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const state = randomBytes(16).toString('hex');
  const clientId = process.env.KICK_CLIENT_ID ?? '';
  const appUrl = (process.env.APP_URL ?? process.env.KICK_APP_URL ?? 'https://tazo.wtf').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/viewer/kick-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user:read',
    state,
  });

  const authUrl = `https://id.kick.com/oauth/authorize?${params.toString()}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('viewer_kick_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });

  return response;
}
