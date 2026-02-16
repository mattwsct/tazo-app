import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled } from '@/types/kick-messages';

const KICK_MESSAGES_KEY = 'kick_message_templates';
const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [stored, storedEnabled] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
    ]);
    const messages = { ...DEFAULT_KICK_MESSAGES, ...stored };
    const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled };
    return NextResponse.json({ messages, enabled });
  } catch {
    return NextResponse.json({
      messages: DEFAULT_KICK_MESSAGES,
      enabled: DEFAULT_KICK_MESSAGE_ENABLED,
    });
  }
}

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const messagesBody = body.messages as Partial<KickMessageTemplates> | undefined;
    const enabledBody = body.enabled as Partial<KickMessageEnabled> | undefined;
    const { enabled: _e, ...rest } = body;
    const updates: Partial<KickMessageTemplates> = messagesBody ?? rest;
    const hasMessageUpdates = Object.keys(updates).length > 0;

    const hasEnabledUpdates = enabledBody && typeof enabledBody === 'object';

    if (hasMessageUpdates) {
      const stored = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
      const merged = { ...DEFAULT_KICK_MESSAGES, ...stored, ...updates };
      await kv.set(KICK_MESSAGES_KEY, merged);
    }

    if (hasEnabledUpdates) {
      const stored = await kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY);
      const merged = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...stored, ...enabledBody };
      await kv.set(KICK_MESSAGE_ENABLED_KEY, merged);
    }

    const [messages, enabled] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
    ]);
    return NextResponse.json({
      messages: { ...DEFAULT_KICK_MESSAGES, ...messages },
      enabled: { ...DEFAULT_KICK_MESSAGE_ENABLED, ...enabled },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
