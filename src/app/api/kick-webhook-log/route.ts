import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';

const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [log, debug] = await Promise.all([
      kv.lrange<{ eventType: string; at: string }[]>(KICK_WEBHOOK_LOG_KEY, 0, 19),
      kv.get<{ at: string; eventType: string; bodyLen: number; hasSig: boolean; hasMsgId: boolean; hasTs: boolean; verified: boolean }>(KICK_WEBHOOK_DEBUG_KEY),
    ]);
    return NextResponse.json({
      log: log ?? [],
      debug: debug ?? null,
    });
  } catch {
    return NextResponse.json({ log: [], debug: null });
  }
}
