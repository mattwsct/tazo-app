/**
 * Vercel Cron: Heals stream live state by checking the Kick public API.
 * Runs every minute, token-independent — uses the unauthenticated public v2 API
 * so it always runs even when the Kick OAuth token is expired or missing.
 *
 * Fixes cases where KV is stale (e.g. missed webhook, 48h auto-rotation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { isStreamLive, setStreamLive, onStreamStarted, getStreamStartedAt } from '@/utils/stats-storage';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = (await kv.get<string>(KICK_BROADCASTER_SLUG_KEY)) ?? 'tazo';

  let apiIsLive: boolean | null = null;
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TazoApp/1.0 (stream-integration)',
      },
      next: { revalidate: 0 },
    });
    if (res.ok) {
      const data = await res.json();
      // `livestream` is an object when live, null when offline
      apiIsLive = data?.livestream != null;
    }
  } catch { /* ignore — return early below */ }

  if (apiIsLive === null) {
    console.log('[Cron LiveCheck] API_UNAVAILABLE', JSON.stringify({ slug }));
    return NextResponse.json({ ok: true, healed: false, reason: 'api_unavailable' });
  }

  const kvIsLive = await isStreamLive();

  if (apiIsLive !== kvIsLive) {
    await setStreamLive(apiIsLive);
    console.log('[Cron LiveCheck] HEALED', JSON.stringify({ slug, apiIsLive, kvWas: kvIsLive }));
  }

  // If live but session was never started (e.g. webhook missed go-live), restore it.
  if (apiIsLive) {
    const startedAt = await getStreamStartedAt();
    if (startedAt == null) {
      await onStreamStarted();
      console.log('[Cron LiveCheck] HEAL_SESSION', JSON.stringify({ slug, reason: 'live_but_no_started_at' }));
    }
  }

  return NextResponse.json({ ok: true, healed: apiIsLive !== kvIsLive, apiIsLive, kvIsLive });
}
