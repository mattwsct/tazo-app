import { NextResponse } from 'next/server';
import { txtResponse } from './shared';

export async function handleUptimeRoutes(route: string): Promise<NextResponse | null> {
  if (route !== 'uptime' && route !== 'up' && route !== 'downtime' && route !== 'down') {
    return null;
  }

  // Uptime (stream session) — caps at stream end when stream has ended
  if (route === 'uptime' || route === 'up') {
    const { getStreamStartedAt, getStreamEndedAt } = await import('@/utils/stats-storage');
    const [startedAt, endedAt] = await Promise.all([getStreamStartedAt(), getStreamEndedAt()]);
    if (!startedAt) return txtResponse('⏱️ No stream session. Uptime resets when you go live.');
    const endTs = endedAt ?? Date.now();
    const ms = endTs - startedAt;
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h % 24 > 0) parts.push(`${h % 24}h`);
    parts.push(`${m % 60}m`);
    if (endedAt != null) {
      const sinceEnd = Date.now() - endedAt;
      const sm = Math.floor(sinceEnd / 60000);
      const sh = Math.floor(sm / 60);
      const sd = Math.floor(sh / 24);
      const sinceParts: string[] = [];
      if (sd > 0) sinceParts.push(`${sd}d`);
      if (sh % 24 > 0) sinceParts.push(`${sh % 24}h`);
      sinceParts.push(`${sm % 60}m`);
      return txtResponse(`⏱️ ${parts.join(' ')} · Stream ended ${sinceParts.join(' ')} ago`);
    }
    return txtResponse(`⏱️ ${parts.join(' ')}`);
  }

  // Downtime — time since stream ended
  if (route === 'downtime' || route === 'down') {
    const { getStreamEndedAt } = await import('@/utils/stats-storage');
    const endedAt = await getStreamEndedAt();
    if (!endedAt) return txtResponse('⏱️ Stream has not ended yet. Use !uptime for live duration.');
    const sinceEnd = Date.now() - endedAt;
    const sec = Math.floor(sinceEnd / 1000);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h % 24 > 0) parts.push(`${h % 24}h`);
    parts.push(`${m % 60}m`);
    return txtResponse(`⏱️ Time since stream ended: ${parts.join(' ')}`);
  }

  return null;
}
