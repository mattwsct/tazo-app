import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 60; // cache for 60 seconds

async function checkKick(): Promise<boolean> {
  try {
    const res = await fetch('https://kick.com/api/v2/channels/tazo', {
      headers: { 'User-Agent': 'tazo.wtf/1.0' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.livestream;
  } catch {
    return false;
  }
}

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
  const [kick, twitch] = await Promise.all([checkKick(), checkTwitch()]);
  return NextResponse.json({ kick, twitch }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
  });
}
