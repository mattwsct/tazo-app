import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

/**
 * POST /api/kick-oauth/disconnect
 * Clears stored Kick OAuth tokens. Requires admin auth.
 */
export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await kv.del(KICK_TOKENS_KEY);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to disconnect';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
