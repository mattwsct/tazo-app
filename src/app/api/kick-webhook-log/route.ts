import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';

const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';
const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [log, debug, storedEnabled] = await Promise.all([
      kv.lrange<{ eventType: string; at: string }[]>(KICK_WEBHOOK_LOG_KEY, 0, 19),
      kv.get<Record<string, unknown>>(KICK_WEBHOOK_DEBUG_KEY),
      kv.get<Record<string, unknown>>(KICK_MESSAGE_ENABLED_KEY),
    ]);
    return NextResponse.json({
      log: log ?? [],
      debug: debug ?? null,
      storedEnabledInKv: storedEnabled ?? null,
    });
  } catch {
    return NextResponse.json({ log: [], debug: null, storedEnabledInKv: null });
  }
}
