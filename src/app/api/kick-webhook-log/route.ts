import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';

const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const log = (await kv.lrange<{ eventType: string; at: string }[]>(KICK_WEBHOOK_LOG_KEY, 0, 19)) ?? [];
    return NextResponse.json({ log });
  } catch {
    return NextResponse.json({ log: [] });
  }
}
