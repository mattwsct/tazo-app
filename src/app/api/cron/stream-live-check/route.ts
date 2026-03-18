/**
 * Vercel Cron: Heals stream live state by checking the Kick authenticated API.
 * Runs every minute as a focused, lightweight check — separate from kick-chat-broadcast
 * so it isn't skipped by that cron's early-exit conditions.
 *
 * Note: The unauthenticated public kick.com API blocks server-side requests,
 * so we must use the authenticated api.kick.com endpoint (same as checkKickIsLive).
 *
 * Fixes cases where KV is stale (e.g. missed webhook, 48h auto-rotation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStreamLive, setStreamLive, onStreamStarted, getStreamStartedAt } from '@/utils/stats-storage';
import { checkKickIsLive } from '@/lib/kick-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiIsLive = await checkKickIsLive();

  if (apiIsLive === null) {
    console.log('[Cron LiveCheck] API_UNAVAILABLE — no token or API error');
    return NextResponse.json({ ok: true, healed: false, reason: 'api_unavailable' });
  }

  const kvIsLive = await isStreamLive();

  if (apiIsLive !== kvIsLive) {
    await setStreamLive(apiIsLive);
    console.log('[Cron LiveCheck] HEALED', JSON.stringify({ apiIsLive, kvWas: kvIsLive }));
  }

  // If live but session was never started (e.g. webhook missed go-live), restore it.
  if (apiIsLive) {
    const startedAt = await getStreamStartedAt();
    if (startedAt == null) {
      await onStreamStarted();
      console.log('[Cron LiveCheck] HEAL_SESSION — live but no stream_started_at');
    }
  }

  return NextResponse.json({ ok: true, healed: apiIsLive !== kvIsLive, apiIsLive, kvIsLive });
}
