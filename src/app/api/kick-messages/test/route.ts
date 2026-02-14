import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sendKickChatMessage, refreshKickTokens } from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';

const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let content: string;
  try {
    const body = await request.json();
    content = typeof body.content === 'string' ? body.content.trim() : '';
  } catch {
    content = '';
  }

  if (!content) {
    return NextResponse.json({ error: 'Message content required' }, { status: 400 });
  }

  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) {
    return NextResponse.json({
      error: 'Not connected. Connect Kick first.',
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
      return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
    }
  }

  try {
    await sendKickChatMessage(accessToken, content);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
