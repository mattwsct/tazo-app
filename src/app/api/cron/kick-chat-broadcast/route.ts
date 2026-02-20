/**
 * Vercel Cron: Sends location and/or heart rate updates to Kick chat when enabled.
 * Pushes stream title updates when location changes and autoUpdateLocation is on.
 * Runs every 2 minutes.
 *
 * Location (unified): Stream title + chat both run only when live, at most every N min (configurable).
 * - Stream title: when autoUpdateLocation is on
 * - Chat: when chatBroadcastLocation is on (toggle)
 *
 * Heart rate: high/very-high warning on threshold crossing. No spam until HR drops below, then exceeds again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import type { LocationDisplayMode } from '@/types/settings';
import { getHeartrateStats } from '@/utils/stats-storage';
import { getCountryFlagEmoji } from '@/utils/chat-utils';
import { formatLocationForStreamTitle, buildStreamTitle } from '@/utils/stream-title-utils';
import type { StreamTitleLocationDisplay } from '@/utils/stream-title-utils';

import { KICK_API_BASE, getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';

const KICK_STREAM_TITLE_SETTINGS_KEY = 'kick_stream_title_settings';
const KICK_BROADCAST_LAST_LOCATION_KEY = 'kick_chat_broadcast_last_location';
const KICK_BROADCAST_LAST_LOCATION_MSG_KEY = 'kick_chat_broadcast_last_location_msg';
const KICK_BROADCAST_HEARTRATE_STATE_KEY = 'kick_chat_broadcast_heartrate_state';
const KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY = 'kick_chat_broadcast_heartrate_last_sent';
const OVERLAY_SETTINGS_KEY = 'overlay_settings';

type HeartrateBroadcastState = 'below' | 'high' | 'very_high';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runAt = new Date().toISOString();
  console.log('[Cron HR] CRON_START', JSON.stringify({ runAt }));
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'no_token', runAt }));
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const [storedAlert, lastLocationAt, lastLocationMsg, hrState, overlaySettings, streamTitleSettings] = await Promise.all([
    kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY),
    kv.get<number>(KICK_BROADCAST_LAST_LOCATION_KEY),
    kv.get<string>(KICK_BROADCAST_LAST_LOCATION_MSG_KEY),
    kv.get<HeartrateBroadcastState>(KICK_BROADCAST_HEARTRATE_STATE_KEY),
    kv.get<{ locationDisplay?: string }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ autoUpdateLocation?: boolean; customTitle?: string; locationDisplay?: StreamTitleLocationDisplay; includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
  ]);

  const now = Date.now();
  const minBpm = (storedAlert?.chatBroadcastHeartrateMinBpm as number) ?? 100;
  let veryHighBpm = (storedAlert?.chatBroadcastHeartrateVeryHighBpm as number) ?? 120;
  if (veryHighBpm <= minBpm) veryHighBpm = minBpm + 1; // Disable very-high tier if not above high
  let currentHrState: HeartrateBroadcastState = (hrState === 'below' || hrState === 'high' || hrState === 'very_high') ? hrState : 'below';

  let sent = 0;

  // Unified location: stream title + chat — both only when live, at most every N min
  const autoUpdateLocation = streamTitleSettings?.autoUpdateLocation !== false;
  const chatBroadcastLocation = storedAlert?.chatBroadcastLocation === true;
  const intervalMin = (storedAlert?.chatBroadcastLocationIntervalMin as number) ?? 5;
  const intervalMs = intervalMin * 60 * 1000;
  const wantsLocationUpdate = autoUpdateLocation || chatBroadcastLocation;

  if (wantsLocationUpdate) {
    let isLive = false;
    let currentTitle = '';
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (channelRes.ok) {
      try {
        const channelData = await channelRes.json();
        const ch = (channelData.data ?? [])[0];
        isLive = !!(ch?.livestream?.is_live ?? ch?.is_live);
        currentTitle = (ch?.stream_title ?? '').trim();
      } catch {
        // ignore
      }
    }

    if (isLive) {
      const persistent = await getPersistentLocation();
      const lastAt = typeof lastLocationAt === 'number' ? lastLocationAt : 0;
      const intervalOk = now - lastAt >= intervalMs;

      if (persistent?.location && intervalOk) {
        const includeLocationInTitle = streamTitleSettings?.includeLocationInTitle !== false;
        const displayForTitle = (streamTitleSettings?.locationDisplay as StreamTitleLocationDisplay) ?? 'state';
        const formattedForTitle = includeLocationInTitle ? formatLocationForStreamTitle(persistent.location, displayForTitle) : '';
        const displayMode = (overlaySettings?.locationDisplay as LocationDisplayMode) || 'city';
        let formattedForChat: string | null = null;
        if (displayMode !== 'hidden') {
          const formatted = formatLocation(persistent.location, displayMode);
          const parts: string[] = [];
          if (formatted.primary?.trim()) parts.push(formatted.primary.trim());
          if (formatted.secondary?.trim()) parts.push(formatted.secondary.trim());
          const flag = persistent.location.countryCode ? getCountryFlagEmoji(persistent.location.countryCode.toUpperCase()) : '';
          const locationStr = parts.length > 0 ? `${flag} ${parts.join(', ')}` : null;
          formattedForChat = locationStr ? `Tazo has moved to ${locationStr}` : null;
        }

        const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
        const newFullTitle = formattedForTitle ? buildStreamTitle(customTitle, formattedForTitle) : '';
        const titleChanged = formattedForTitle && newFullTitle !== currentTitle;
        // Use formattedForTitle as dedup key so we don't re-send when location unchanged
        const locationAnnouncedChanged = formattedForTitle && formattedForTitle !== lastLocationMsg;
        const locationChanged = titleChanged || locationAnnouncedChanged;

        if (locationChanged) {
          if (autoUpdateLocation && titleChanged && formattedForTitle && newFullTitle) {
            try {
              const patchRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ stream_title: newFullTitle }),
              });
              if (patchRes.ok) sent++;
            } catch {
              // ignore
            }
          }
          let lastMsgToStore = formattedForTitle ?? '';
          if (chatBroadcastLocation && locationChanged) {
            // When title updates with location, combine into one chat message so viewers see the new title
            const chatMsg = titleChanged && newFullTitle
              ? `Stream title updated to "${newFullTitle}" with new location`
              : formattedForChat;
            if (chatMsg) {
              try {
                await sendKickChatMessage(accessToken, chatMsg);
                sent++;
                lastMsgToStore = chatMsg;
                console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'location', msgPreview: chatMsg.slice(0, 80) }));
              } catch (err) {
                console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'location', error: err instanceof Error ? err.message : String(err) }));
              }
            }
          }
          await kv.set(KICK_BROADCAST_LAST_LOCATION_KEY, now);
          await kv.set(KICK_BROADCAST_LAST_LOCATION_MSG_KEY, lastMsgToStore);
        }
      }
    }
  }

  if (!storedAlert?.chatBroadcastHeartrate) {
    if (storedAlert?.chatBroadcastLocation) console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrBroadcast: false, locationBroadcast: true }));
  } else {
    const hrStats = await getHeartrateStats();
    const bpm = hrStats.current?.bpm ?? 0;
    if (!hrStats.hasData || bpm === 0) {
      console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrData: false, hasData: hrStats.hasData, bpm }));
    }

    if (bpm < minBpm) {
      currentHrState = 'below';
      if (hrState !== 'below') console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: '->below', bpm, minBpm }));
    } else if (veryHighBpm > minBpm && bpm >= veryHighBpm) {
      if (currentHrState !== 'very_high') {
        const msg = `⚠️ Very high heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'very_high';
          sent++;
          await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_very_high', bpm, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_very_high', error: err instanceof Error ? err.message : String(err) }));
        }
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_very_high', state: currentHrState }));
      }
    } else if (bpm >= minBpm) {
      if (currentHrState === 'below') {
        const msg = `❤️ High heart rate: ${bpm} BPM`;
        try {
          await sendKickChatMessage(accessToken, msg);
          currentHrState = 'high';
          sent++;
          await kv.set(KICK_BROADCAST_HEARTRATE_LAST_SENT_KEY, now);
          console.log('[Cron HR] CHAT_SENT', JSON.stringify({ type: 'heartrate_high', bpm, msgPreview: msg.slice(0, 50) }));
        } catch (err) {
          console.error('[Cron HR] CHAT_FAIL', JSON.stringify({ type: 'heartrate_high', error: err instanceof Error ? err.message : String(err) }));
        }
      } else if (currentHrState === 'very_high' && bpm < veryHighBpm) {
        currentHrState = 'high';
        console.log('[Cron HR] CRON_DEBUG', JSON.stringify({ hrStateChange: 'very_high->high', bpm }));
      } else {
        console.log('[Cron HR] CRON_SKIP', JSON.stringify({ reason: 'already_sent_high', state: currentHrState, bpm }));
      }
    }

    if (currentHrState !== (hrState as HeartrateBroadcastState)) {
      await kv.set(KICK_BROADCAST_HEARTRATE_STATE_KEY, currentHrState);
    }
  }

  console.log('[Cron HR] CRON_END', JSON.stringify({ sent, runAt }));
  return NextResponse.json({ ok: true, sent });
}
