/**
 * Vercel Cron: Sends location and/or heart rate updates to Kick chat when enabled.
 * Runs every 2 minutes.
 * Location: time-based interval.
 * Heart rate: high/very-high warning on threshold crossing. No spam until HR drops below, then exceeds again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sendKickChatMessage, refreshKickTokens } from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';
import { getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import type { LocationDisplayMode } from '@/types/settings';
import { getHeartrateStats } from '@/utils/stats-storage';
import { getCountryFlagEmoji } from '@/utils/chat-utils';

const KICK_TOKENS_KEY = 'kick_tokens';
const KICK_ALERT_SETTINGS_KEY = 'kick_alert_settings';
const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';
const KICK_BROADCAST_HEARTRATE_STATE_KEY = 'kick_chat_broadcast_heartrate_state';
const OVERLAY_SETTINGS_KEY = 'overlay_settings';

type HeartrateBroadcastState = 'below' | 'high' | 'very_high';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function getValidAccessToken(): Promise<string | null> {
  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) return null;

  const now = Date.now();
  const bufferMs = 60 * 1000;
  if (stored.expires_at - bufferMs > now) return stored.access_token;

  try {
    const tokens = await refreshKickTokens(stored.refresh_token);
    const expiresAt = now + tokens.expires_in * 1000;
    await kv.set(KICK_TOKENS_KEY, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
    });
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ ok: true, sent: 0 });

  const [storedAlert, lastLocationSent, hrState, overlaySettings] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<HeartrateBroadcastState>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<{ locationDisplay?: string }>(OVERLAY_SETTINGS_KEY),
  ]);

  const now = Date.now();
  const locationIntervalMs = ((storedAlert?.chatBroadcastLocationIntervalMin as number) ?? 5) * 60 * 1000;
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1; // Disable very-high tier if not above high
  let currentHrState: HeartrateBroadcastState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

  let sent = 0;

  if (storedAlert?.chatBroadcastLocation && (lastLocationSent == null || now - lastLocationSent >= locationIntervalMs)) {
    const persistent = await getPersistentLocation();
    if (persistent?.location) {
      const displayMode = (overlaySettings?.locationDisplay as LocationDisplayMode) || 'city';
      if (displayMode !== 'hidden') {
        const formatted = formatLocation(persistent.location, displayMode);
        const parts: string[] = [];
        if (formatted.primary?.trim()) parts.push(formatted.primary.trim());
        if (formatted.secondary?.trim()) parts.push(formatted.secondary.trim());
        const flag = persistent.location.countryCode ? getCountryFlagEmoji(persistent.location.countryCode.toUpperCase()) : '';
        const msg = parts.length > 0 ? `${flag} ${parts.join(', ')}` : null;
        if (msg) {
          try {
            await sendKickChatMessage(accessToken, msg);
            await kv.set(KICK_BROADCAST_LAST_LOCATION_KEY, now);
            sent++;
          } catch {
            // Ignore send failures
          }
        }
      }
    }
  }

  if (storedAlert?.chatBroadcastHeartrate) {
    const hrStats = await getHeartrateStats();
    const bpm = hrStats.current?.bpm ?? 0;

    if (bpm < minBpm) {
      currentHrState = 'below';
    } else if (veryHighBpm > minBpm && bpm >= veryHighBpm) {
      if (currentHrState !== 'very_high') {
        const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'very_high';
          sent++;
        } catch {
          // Ignore send failures
        }
      }
    } else if (bpm >= minBpm) {
      if (currentHrState === 'below') {
        const msg = `❤️ High heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'high';
          sent++;
        } catch {
          // Ignore send failures
        }
      } else if (currentHrState === 'very_high' && bpm < veryHighBpm) {
        currentHrState = 'high';
      }
    }

    if (currentHrState !== (hrState as HeartrateBroadcastState)) {
      await kv.set(KICK_BROADCAST_HEARTRATE_STATE_KEY, currentHrState);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
