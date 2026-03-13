/**
 * Lightweight endpoint for overlay to trigger timer-end announcement when countdown reaches 0.
 * Posts "Time's up!" to chat once per timer. Idempotent: uses KV to avoid duplicate announcements.
 * Accepts ?endsAt=<ms> to identify which timer ended.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOverlayTimers } from '@/utils/overlay-timer-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const endsAtParam = url.searchParams.get('endsAt');
    const endsAt = endsAtParam ? parseInt(endsAtParam, 10) : null;

    const [timers, token] = await Promise.all([
      getOverlayTimers(),
      getValidAccessToken(),
    ]);

    if (!token) return NextResponse.json({ ok: true, acted: false });

    const now = Date.now();
    // Match specific timer if endsAt provided, otherwise fall back to first expired
    const expired = timers.filter((t) => t.endsAt <= now);
    const timer = endsAt != null
      ? expired.find((t) => t.endsAt === endsAt)
      : expired[0];

    if (!timer) return NextResponse.json({ ok: true, acted: false });

    // Atomic claim: only the first concurrent request wins.
    const claimKey = `overlay_timer_announced:${timer.endsAt}`;
    const claimed = await kv.set(claimKey, 1, { nx: true, ex: 3600 });
    if (claimed === null) return NextResponse.json({ ok: true, acted: false });

    const label = timer.title?.trim();
    const message = label ? `⏱️ ${label} — Time's up!` : "⏱️ Time's up!";
    await sendKickChatMessage(token, message);

    return NextResponse.json({ ok: true, acted: true });
  } catch (err) {
    console.error('[timer-end-trigger]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
