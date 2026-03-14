import { NextRequest, NextResponse } from 'next/server';
import { createViewerToken, verifyViewerToken, VIEWER_COOKIE_NAME, VIEWER_SESSION_TTL_MS } from '@/lib/viewer-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // CSRF: verify state matches cookie
  const storedState = request.cookies.get('viewer_kick_state')?.value;
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/dashboard?error=invalid_state', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard?error=no_code', request.url));
  }

  const appUrl = process.env.KICK_APP_URL ?? '';
  const redirectUri = `${appUrl}/api/viewer/kick-callback`;

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.KICK_CLIENT_ID ?? '',
        client_secret: process.env.KICK_CLIENT_SECRET ?? '',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[viewer/kick-callback] token exchange failed:', err);
      return NextResponse.redirect(new URL('/dashboard?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.redirect(new URL('/dashboard?error=no_access_token', request.url));
    }

    // Fetch user info — try v1 first, fallback to v2
    let kickId: string | undefined;
    let kickUsername: string | undefined;

    try {
      const userRes = await fetch('https://api.kick.com/public/v1/users', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json() as { data?: Array<{ user_id?: string | number; username?: string; name?: string }> };
        const user = userData.data?.[0];
        if (user) {
          kickId = String(user.user_id ?? '');
          kickUsername = user.username ?? user.name ?? '';
        }
      }
    } catch {
      // ignore, try fallback
    }

    if (!kickId) {
      try {
        const userRes = await fetch('https://kick.com/api/v2/user', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json() as { id?: string | number; username?: string; name?: string };
          kickId = String(userData.id ?? '');
          kickUsername = userData.username ?? userData.name ?? '';
        }
      } catch {
        // ignore
      }
    }

    if (!kickId) {
      return NextResponse.redirect(new URL('/dashboard?error=failed_to_fetch_user', request.url));
    }

    // Merge with existing session if Discord is already connected
    const existingSession = verifyViewerToken(request.cookies.get(VIEWER_COOKIE_NAME)?.value ?? '');
    const exp = Date.now() + VIEWER_SESSION_TTL_MS;

    const tokenPayload = createViewerToken({
      kickId,
      kickUsername,
      discordId: existingSession?.discordId,
      discordUsername: existingSession?.discordUsername,
      exp,
    });

    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    response.cookies.set(VIEWER_COOKIE_NAME, tokenPayload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: VIEWER_SESSION_TTL_MS / 1000,
      path: '/',
    });
    // Clear the state cookie
    response.cookies.set('viewer_kick_state', '', { maxAge: 0, path: '/' });

    return response;
  } catch (error) {
    console.error('[viewer/kick-callback] unexpected error:', error);
    return NextResponse.redirect(new URL('/dashboard?error=unexpected', request.url));
  }
}
