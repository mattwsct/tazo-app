/**
 * Lightweight endpoint for overlay to trigger timer-end announcement when countdown reaches 0.
 * Posts "Time's up!" to chat once per timer. Idempotent: uses KV to avoid duplicate announcements.
 */

import { NextResponse } from 'next/server';
import { getOverlayTimer } from '@/utils/overlay-timer-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const [timer, token] = await Promise.all([
      getOverlayTimer(),
      getValidAccessToken(),
    ]);

    if (!timer || !token) {
      return NextResponse.json({ ok: true, acted: false });
    }

    const now = Date.now();
    if (timer.endsAt > now) {
      return NextResponse.json({ ok: true, acted: false });
    }

    // Atomic claim: only the first concurrent request wins (NX = set only if key absent).
    // Key is scoped to this specific timer's endsAt so different timers get independent claims.
    const claimKey = `overlay_timer_announced:${timer.endsAt}`;
    const claimed = await kv.set(claimKey, 1, { nx: true, ex: 3600 });
    if (claimed === null) {
      return NextResponse.json({ ok: true, acted: false });
    }

    const label = timer.title?.trim();
    const message = label ? `⏱️ ${label} — Time's up!` : "⏱️ Time's up!";

    await sendKickChatMessage(token, message);

    return NextResponse.json({ ok: true, acted: true });
  } catch (err) {
    console.error('[timer-end-trigger]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
