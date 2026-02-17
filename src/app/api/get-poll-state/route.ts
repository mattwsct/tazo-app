import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
import { POLL_STATE_KEY } from '@/types/poll';

export const dynamic = 'force-dynamic';

/** Lightweight endpoint for overlay to poll vote updates during active poll. 1 KV read (cheaper than get-settings). */
export async function GET(): Promise<NextResponse> {
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    return new NextResponse('Server configuration error', { status: 500 });
  }
  try {
    logKVUsage('read');
    const pollState = await kv.get(POLL_STATE_KEY);
    return NextResponse.json({ pollState: pollState ?? null }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch {
    return NextResponse.json({ pollState: null }, { status: 200 });
  }
}
