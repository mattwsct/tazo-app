/**
 * Kick channel API - get/update stream title.
 * Uses stored OAuth token. Requires channel:read and channel:write scopes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { refreshKickTokens } from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';

const KICK_API_BASE = 'https://api.kick.com';
const KICK_TOKENS_KEY = 'kick_tokens';
const KICK_STREAM_TITLE_SETTINGS_KEY = 'kick_stream_title_settings';
const KICK_BROADCASTER_SLUG_KEY = 'kick_broadcaster_slug';

export type StreamTitleLocationDisplay = 'city' | 'state' | 'country';

export interface StreamTitleSettings {
  customTitle: string;
  locationDisplay: StreamTitleLocationDisplay;
  autoUpdateLocation: boolean;
  /** When false, stream title shows no location (overlay/chat still use location). */
  includeLocationInTitle?: boolean;
}

export const DEFAULT_STREAM_TITLE_SETTINGS: StreamTitleSettings = {
  customTitle: '',
  locationDisplay: 'state',
  autoUpdateLocation: true,
  includeLocationInTitle: true,
};

export const dynamic = 'force-dynamic';

async function getValidAccessToken(): Promise<string | null> {
  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) return null;

  const now = Date.now();
  const bufferMs = 60 * 1000;
  if (stored.expires_at - bufferMs > now) {
    return stored.access_token;
  }

  try {
    const tokens = await refreshKickTokens(stored.refresh_token);
    const expiresAt = now + tokens.expires_in * 1000;
    await kv.set(KICK_TOKENS_KEY, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
    });
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const stored = await kv.get<Record<string, unknown>>(KICK_STREAM_TITLE_SETTINGS_KEY);
  const locDisplay = stored?.locationDisplay as string | undefined;
  const migratedDisplay: StreamTitleLocationDisplay =
    locDisplay === 'country' || locDisplay === 'country_only' ? 'country' :
    locDisplay === 'state' || locDisplay === 'country_state' || locDisplay === 'state_country' ? 'state' :
    locDisplay === 'city' || locDisplay === 'country_city' || locDisplay === 'city_state' ? 'city' :
    DEFAULT_STREAM_TITLE_SETTINGS.locationDisplay;
  const settingsResponse: StreamTitleSettings = {
    ...DEFAULT_STREAM_TITLE_SETTINGS,
    ...(stored as Partial<StreamTitleSettings>),
    locationDisplay: migratedDisplay,
  };

  if (!accessToken) {
    return NextResponse.json({
      stream_title: '',
      settings: settingsResponse,
      error: 'Not connected to Kick',
    });
  }

  const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    const hint = res.status === 401
      ? ' Reconnect Kick (Reconnect button above) to grant channel:read and channel:write scopes.'
      : '';
    return NextResponse.json({
      error: `Kick API ${res.status}: ${err}${hint}`,
      stream_title: '',
      settings: settingsResponse,
    }, { status: 502 });
  }

  const data = await res.json();
  const ch = (data.data ?? [])[0];
  const livestream = ch?.livestream;
  const isLive = !!(livestream?.is_live ?? ch?.is_live);
  const slug = ch?.slug;
  if (slug && typeof slug === 'string') {
    try { await kv.set(KICK_BROADCASTER_SLUG_KEY, slug); } catch { /* ignore */ }
  }
  return NextResponse.json({
    stream_title: ch?.stream_title ?? '',
    slug,
    is_live: isLive,
    settings: settingsResponse,
  });
}

export async function PATCH(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Not connected to Kick' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const streamTitle = typeof body.stream_title === 'string' ? body.stream_title : undefined;
  const settingsBody = body.settings as Partial<StreamTitleSettings> | undefined;

  // Save settings to KV if provided
  if (settingsBody && typeof settingsBody === 'object') {
    const stored = await kv.get<Partial<StreamTitleSettings>>(KICK_STREAM_TITLE_SETTINGS_KEY);
    const merged: StreamTitleSettings = { ...DEFAULT_STREAM_TITLE_SETTINGS, ...stored, ...settingsBody };
    await kv.set(KICK_STREAM_TITLE_SETTINGS_KEY, merged);
  }

  if (streamTitle === undefined) {
    return NextResponse.json({ success: true });
  }

  const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ stream_title: streamTitle }),
  });

  if (!res.ok) {
    const err = await res.text();
    const hint = res.status === 401
      ? ' Reconnect Kick (Reconnect button above) to grant channel:read and channel:write scopes.'
      : '';
    return NextResponse.json({
      error: `Kick API ${res.status}: ${err}${hint}`,
    }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
