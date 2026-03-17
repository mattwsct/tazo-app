import { randomUUID } from 'crypto';
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
    return NextResponse.redirect(new URL('/me?error=invalid_state', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/me?error=no_code', request.url));
  }

  const codeVerifier = request.cookies.get('viewer_kick_verifier')?.value ?? '';
  const appUrl = (process.env.APP_URL ?? 'https://tazo.wtf').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/viewer/kick-callback`;

  try {
    // Exchange code for access token — Kick requires PKCE code_verifier
    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.KICK_CLIENT_ID ?? '',
        client_secret: process.env.KICK_CLIENT_SECRET ?? '',
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[viewer/kick-callback] token exchange failed:', err);
      return NextResponse.redirect(new URL('/me?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.redirect(new URL('/me?error=no_access_token', request.url));
    }

    // Fetch user info — try v1 API with multiple response shapes
    let kickId: string | undefined;
    let kickUsername: string | undefined;

    // Try v1 API — handles both array and object response shapes
    try {
      const userRes = await fetch('https://api.kick.com/public/v1/users', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (userRes.ok) {
        const raw = await userRes.json() as Record<string, unknown>;
        // Shape 1: { data: [ { user_id, username } ] }
        if (Array.isArray(raw.data)) {
          const u = (raw.data as Array<Record<string, unknown>>)[0];
          if (u) { kickId = String(u.user_id ?? u.id ?? ''); kickUsername = String(u.username ?? u.name ?? ''); }
        }
        // Shape 2: { data: { user_id, username } }
        else if (raw.data && typeof raw.data === 'object') {
          const u = raw.data as Record<string, unknown>;
          kickId = String(u.user_id ?? u.id ?? '');
          kickUsername = String(u.username ?? u.name ?? '');
        }
        // Shape 3: { user_id, username } (flat)
        else if (raw.user_id ?? raw.id) {
          kickId = String(raw.user_id ?? raw.id ?? '');
          kickUsername = String(raw.username ?? raw.name ?? '');
        }
        if (kickId === '') kickId = undefined;
        if (kickUsername === '') kickUsername = undefined;
      } else {
        console.error('[viewer/kick-callback] v1 users status:', userRes.status, await userRes.text());
      }
    } catch (e) {
      console.error('[viewer/kick-callback] v1 fetch error:', e);
    }

    // Try v1 singular endpoint as fallback
    if (!kickId) {
      try {
        const userRes = await fetch('https://api.kick.com/public/v1/user', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (userRes.ok) {
          const raw = await userRes.json() as Record<string, unknown>;
          if (Array.isArray(raw.data)) {
            const u = (raw.data as Array<Record<string, unknown>>)[0];
            if (u) { kickId = String(u.user_id ?? u.id ?? ''); kickUsername = String(u.username ?? u.name ?? ''); }
          } else if (raw.data && typeof raw.data === 'object') {
            const u = raw.data as Record<string, unknown>;
            kickId = String(u.user_id ?? u.id ?? '');
            kickUsername = String(u.username ?? u.name ?? '');
          } else if (raw.user_id ?? raw.id) {
            kickId = String(raw.user_id ?? raw.id ?? '');
            kickUsername = String(raw.username ?? raw.name ?? '');
          }
          if (kickId === '') kickId = undefined;
          if (kickUsername === '') kickUsername = undefined;
        } else {
          console.error('[viewer/kick-callback] v1 singular users status:', userRes.status, await userRes.text());
        }
      } catch (e) {
        console.error('[viewer/kick-callback] v1 singular fetch error:', e);
      }
    }

    // Try v2 API as final fallback
    if (!kickId) {
      try {
        const userRes = await fetch('https://kick.com/api/v2/user', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json() as { id?: string | number; username?: string; name?: string };
          kickId = String(userData.id ?? '');
          kickUsername = userData.username ?? userData.name ?? '';
          if (kickId === '') kickId = undefined;
          if (kickUsername === '') kickUsername = undefined;
        }
      } catch {
        // ignore
      }
    }

    if (!kickId) {
      return NextResponse.redirect(new URL('/me?error=failed_to_fetch_user', request.url));
    }

    // Merge with existing session if Discord is already connected, preserve viewerUuid
    const existingSession = verifyViewerToken(request.cookies.get(VIEWER_COOKIE_NAME)?.value ?? '');
    const viewerUuid = existingSession?.viewerUuid ?? randomUUID();
    const exp = Date.now() + VIEWER_SESSION_TTL_MS;

    const tokenPayload = createViewerToken({
      viewerUuid,
      kickId,
      kickUsername,
      discordId: existingSession?.discordId,
      discordUsername: existingSession?.discordUsername,
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
    response.cookies.set('viewer_kick_state', '', { maxAge: 0, path: '/' });
    response.cookies.set('viewer_kick_verifier', '', { maxAge: 0, path: '/' });

    // Fire-and-forget: persist viewer identity to Supabase
    void (async () => {
      try {
        const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
        if (!isSupabaseConfigured()) return;
        const { data: creator } = await supabase.from('creators').select('id').eq('slug', 'tazo').single();
        if (!creator) return;
        await supabase.from('viewer_profiles').upsert(
          { creator_id: creator.id, platform: 'kick', platform_id: kickId, username: kickUsername, viewer_uuid: viewerUuid },
          { onConflict: 'creator_id,platform,platform_id' }
        );
        // If discord also connected, link it too
        if (existingSession?.discordId) {
          await supabase.from('viewer_profiles').upsert(
            { creator_id: creator.id, platform: 'discord', platform_id: existingSession.discordId, username: existingSession.discordUsername ?? '', viewer_uuid: viewerUuid },
            { onConflict: 'creator_id,platform,platform_id' }
          );
        }
      } catch (e) { console.error('[kick-callback] supabase sync:', e); }
    })();

    return response;
  } catch (error) {
    console.error('[viewer/kick-callback] unexpected error:', error);
    return NextResponse.redirect(new URL('/me?error=unexpected', request.url));
  }
}
