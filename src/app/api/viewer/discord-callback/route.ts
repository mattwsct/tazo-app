import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createViewerToken, verifyViewerToken, VIEWER_COOKIE_NAME, VIEWER_SESSION_TTL_MS } from '@/lib/viewer-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // CSRF: verify state
  const storedState = request.cookies.get('viewer_discord_state')?.value;
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/me?error=invalid_state', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/me?error=no_code', request.url));
  }

  const appUrl = (process.env.APP_URL ?? process.env.KICK_APP_URL ?? 'https://tazo.wtf').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/viewer/discord-callback`;

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.DISCORD_CLIENT_ID ?? '',
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[viewer/discord-callback] token exchange failed:', err);
      return NextResponse.redirect(new URL('/me?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.redirect(new URL('/me?error=no_access_token', request.url));
    }

    // Fetch Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error('[viewer/discord-callback] failed to fetch user info');
      return NextResponse.redirect(new URL('/me?error=failed_to_fetch_user', request.url));
    }

    const userData = await userRes.json() as { id?: string; username?: string; global_name?: string };
    const discordId = userData.id ?? '';
    const discordUsername = userData.global_name ?? userData.username ?? '';

    if (!discordId) {
      return NextResponse.redirect(new URL('/me?error=failed_to_fetch_user', request.url));
    }

    // Merge with existing Kick session if already connected, preserve viewerUuid
    const existingSession = verifyViewerToken(request.cookies.get(VIEWER_COOKIE_NAME)?.value ?? '');
    const viewerUuid = existingSession?.viewerUuid ?? randomUUID();
    const exp = Date.now() + VIEWER_SESSION_TTL_MS;

    const tokenPayload = createViewerToken({
      viewerUuid,
      kickId: existingSession?.kickId,
      kickUsername: existingSession?.kickUsername,
      discordId,
      discordUsername,
      exp,
    });

    const response = NextResponse.redirect(new URL('/me', request.url));
    response.cookies.set(VIEWER_COOKIE_NAME, tokenPayload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: VIEWER_SESSION_TTL_MS / 1000,
      path: '/',
    });
    // Clear the state cookie
    response.cookies.set('viewer_discord_state', '', { maxAge: 0, path: '/' });

    // Fire-and-forget: persist viewer identity to Supabase
    void (async () => {
      try {
        const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
        if (!isSupabaseConfigured()) return;
        const { data: creator } = await supabase.from('creators').select('id').eq('slug', 'tazo').single();
        if (!creator) return;
        await supabase.from('viewer_profiles').upsert(
          { creator_id: creator.id, platform: 'discord', platform_id: discordId, username: discordUsername, viewer_uuid: viewerUuid },
          { onConflict: 'creator_id,platform,platform_id' }
        );
        // If kick also connected, link it too
        if (existingSession?.kickId) {
          await supabase.from('viewer_profiles').upsert(
            { creator_id: creator.id, platform: 'kick', platform_id: existingSession.kickId, username: existingSession.kickUsername ?? '', viewer_uuid: viewerUuid },
            { onConflict: 'creator_id,platform,platform_id' }
          );
        }
      } catch (e) { console.error('[discord-callback] supabase sync:', e); }
    })();

    return response;
  } catch (error) {
    console.error('[viewer/discord-callback] unexpected error:', error);
    return NextResponse.redirect(new URL('/me?error=unexpected', request.url));
  }
}
