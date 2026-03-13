/**
 * Lightweight endpoint for overlay to trigger timer-end announcement when countdown reaches 0.
 * Posts "Time's up!" to chat once per timer. Idempotent: uses KV to avoid duplicate announcements.
 */

import { NextResponse } from 'next/server';
import { getOverlayTimer } from '@/utils/overlay-timer-storage';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const OVERLAY_TIMER_ANNOUNCED_ENDS_AT_KEY = 'overlay_timer_announced_ends_at';

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

    const lastAnnounced = (await kv.get<number>(OVERLAY_TIMER_ANNOUNCED_ENDS_AT_KEY)) ?? 0;
    if (lastAnnounced === timer.endsAt) {
      return NextResponse.json({ ok: true, acted: false });
    }

    const label = timer.title?.trim();
    const message = label ? `⏱️ ${label} — Time's up!` : "⏱️ Time's up!";

    await sendKickChatMessage(token, message);
    await kv.set(OVERLAY_TIMER_ANNOUNCED_ENDS_AT_KEY, timer.endsAt);

    return NextResponse.json({ ok: true, acted: true });
  } catch (err) {
    console.error('[timer-end-trigger]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
