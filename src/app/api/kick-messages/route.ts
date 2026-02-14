import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { DEFAULT_KICK_MESSAGES } from '@/types/kick-messages';
import type { KickMessageTemplates } from '@/types/kick-messages';

const KICK_MESSAGES_KEY = 'kick_message_templates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stored = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
    const messages = { ...DEFAULT_KICK_MESSAGES, ...stored };
    return NextResponse.json(messages);
  } catch {
    return NextResponse.json(DEFAULT_KICK_MESSAGES);
  }
}

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const stored = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
    const merged = { ...DEFAULT_KICK_MESSAGES, ...stored, ...body };
    await kv.set(KICK_MESSAGES_KEY, merged);
    return NextResponse.json(merged);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
