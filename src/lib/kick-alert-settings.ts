import { kv } from '@/lib/kv';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';
import type { KickAlertSettings } from '@/app/api/kick-messages/route';
import { DEFAULT_KICK_ALERT_SETTINGS } from '@/app/api/kick-messages/route';

export type ResolvedKickAlertSettings = Required<KickAlertSettings>;

/**
 * Loads Kick alert / chat-broadcast settings from KV and merges with defaults.
 * Use this instead of ad-hoc `{ ...DEFAULT_KICK_ALERT_SETTINGS, ...stored }` merges.
 */
export async function loadKickAlertSettings(): Promise<ResolvedKickAlertSettings> {
  const stored = await kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY);
  return { ...DEFAULT_KICK_ALERT_SETTINGS, ...(stored ?? {}) };
}

