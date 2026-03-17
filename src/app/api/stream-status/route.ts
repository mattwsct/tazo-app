import { NextResponse } from 'next/server';
import { isStreamLive } from '@/utils/stats-storage';

export const dynamic = 'force-dynamic';

async function checkTwitch(): Promise<boolean> {
  try {
    const res = await fetch('https://decapi.me/twitch/uptime/tazo', {
      next: { revalidate: 60 },
    });
    if (!res.ok) return false;
    const text = await res.text();
    return !/is\s+offline/i.test(text);
  } catch {
    return false;
  }
}

export async function GET() {
  // Kick live state is maintained by the Kick webhook (livestream.status.updated).
  // The public kick.com API blocks server-side requests, so we use our KV state instead.
  const [kick, twitch] = await Promise.all([isStreamLive(), checkTwitch()]);
  return NextResponse.json({ kick, twitch }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
