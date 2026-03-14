import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const state = randomBytes(16).toString('hex');
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  const appUrl = process.env.APP_URL ?? process.env.KICK_APP_URL ?? 'https://tazo.wtf';
  const redirectUri = `${appUrl}/api/viewer/discord-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });

  const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('viewer_discord_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });

  return response;
}
