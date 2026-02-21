/**
 * Overlay alerts: subs, gifts, kicks displayed in the bottom-right overlay.
 * Stored in KV, consumed by overlay. Max 20 alerts, each shown ~8s.
 */

import { kv } from '@vercel/kv';

const OVERLAY_ALERTS_KEY = 'kick_overlay_alerts';
const MAX_ALERTS = 20;
const ALERT_MAX_AGE_MS = 25_000; // Don't return alerts older than 25s (gives overlay time to poll and display)

export type OverlayAlertType = 'sub' | 'resub' | 'giftSub' | 'kicks';

export interface OverlayAlert {
  id: string;
  type: OverlayAlertType;
  username: string;
  extra?: string; // e.g. "5 subs", "500 kicks", "3 months"
  at: number;
}

function getUsername(obj: unknown): string {
  return String((obj as { username?: string })?.username ?? 'Someone').trim() || 'Someone';
}

/** Push alert for new sub. */
export async function pushSubAlert(subscriber: unknown): Promise<void> {
  const username = getUsername(subscriber);
  await pushAlert({ type: 'sub', username });
}

/** Push alert for resub. */
export async function pushResubAlert(subscriber: unknown, months?: number): Promise<void> {
  const username = getUsername(subscriber);
  const extra = months != null ? `${months} months` : undefined;
  await pushAlert({ type: 'resub', username, extra });
}

/** Push alert for gift subs. */
export async function pushGiftSubAlert(gifter: unknown, count: number): Promise<void> {
  const username = getUsername(gifter);
  const extra = count > 1 ? `${count} subs` : undefined;
  await pushAlert({ type: 'giftSub', username, extra });
}

/** Push alert for kicks gifted. */
export async function pushKicksAlert(sender: unknown, amount: number, giftName?: string): Promise<void> {
  const username = getUsername(sender);
  const extra = giftName ? `${amount} (${giftName})` : `${amount} kicks`;
  await pushAlert({ type: 'kicks', username, extra });
}

/** Push a test alert (from admin). */
export async function pushTestAlert(type: OverlayAlertType): Promise<void> {
  const username = 'TestViewer';
  const extras: Record<OverlayAlertType, string> = {
    sub: '',
    resub: '3 months',
    giftSub: '5 subs',
    kicks: '500 kicks',
  };
  await pushAlert({ type, username, extra: extras[type] || undefined });
}

async function pushAlert(alert: Omit<OverlayAlert, 'id' | 'at'>): Promise<void> {
  const full: OverlayAlert = {
    ...alert,
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    at: Date.now(),
  };
  try {
    await kv.lpush(OVERLAY_ALERTS_KEY, full);
    await kv.ltrim(OVERLAY_ALERTS_KEY, 0, MAX_ALERTS - 1);
  } catch (e) {
    console.warn('[OverlayAlerts] Failed to push:', e);
  }
}

/** Get recent alerts (within ALERT_MAX_AGE_MS). Used by overlay. */
export async function getRecentAlerts(): Promise<OverlayAlert[]> {
  try {
    const raw = await kv.lrange(OVERLAY_ALERTS_KEY, 0, MAX_ALERTS - 1) as unknown[];
    if (!raw || !Array.isArray(raw)) return [];
    const now = Date.now();
    const cutoff = now - ALERT_MAX_AGE_MS;
    return raw.filter((a): a is OverlayAlert => a != null && typeof a === 'object' && typeof (a as OverlayAlert).at === 'number' && (a as OverlayAlert).at > cutoff);
  } catch {
    return [];
  }
}
