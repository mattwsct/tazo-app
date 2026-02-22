/**
 * !title chat command: broadcaster and mods can set stream title (with optional location append).
 */

import { kv } from '@vercel/kv';
import { KICK_API_BASE, KICK_BROADCASTER_SLUG_KEY, KICK_STREAM_TITLE_SETTINGS_KEY, getValidAccessToken } from '@/lib/kick-api';
import { getPersistentLocation, getCachedLocationData } from '@/utils/location-cache';
import { getStreamTitleLocationPart, buildStreamTitle } from '@/utils/stream-title-utils';
import type { LocationDisplayMode } from '@/types/settings';

const OVERLAY_SETTINGS_KEY = 'overlay_settings';

/** Check if sender is broadcaster or mod (from Kick payload). */
function isModOrBroadcaster(
  sender: unknown,
  senderUsername: string,
  broadcasterSlug: string | null
): boolean {
  if (!sender || typeof sender !== 'object') return false;
  const s = sender as Record<string, unknown>;
  const identity = s.identity as Record<string, unknown> | undefined;
  const role = String(identity?.role ?? s.role ?? '').toLowerCase();
  const rolesArr = s.roles as string[] | undefined;
  const rolesLower = Array.isArray(rolesArr) ? rolesArr.map((r) => String(r).toLowerCase()) : [];
  if (role === 'moderator' || role === 'owner' || role === 'broadcaster') return true;
  if (rolesLower.includes('moderator') || rolesLower.includes('owner') || rolesLower.includes('broadcaster')) return true;
  if (s.is_moderator === true || s.moderator === true || s.isModerator === true) return true;
  const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
  if (senderUsername?.toLowerCase() === broadcasterLower) return true;
  return false;
}

export interface HandleStreamTitleResult {
  handled: boolean;
  reply?: string;
}

/**
 * Handle !title <custom title> — set stream title. Broadcaster and mods only.
 * Appends location (if includeLocationInTitle is on and location not hidden).
 */
export async function handleStreamTitleCommand(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleStreamTitleResult> {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!title')) return { handled: false };

  const accessToken = await getValidAccessToken();
  if (!accessToken) return { handled: true, reply: 'Stream title update failed — not connected.' };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(payload.sender, senderUsername, broadcasterSlug)) {
    return { handled: true, reply: 'Only broadcaster and mods can use !title.' };
  }

  // Parse custom title: everything after "!title " (case insensitive)
  const match = trimmed.match(/^!title\s+(.+)$/i);
  const customPart = match?.[1]?.trim() ?? '';

  // Use cached/persistent location only — avoid blocking on RTIRL/LocationIQ (which can hang and prevent title update)
  const [overlaySettings, streamTitleSettings, persistent, cached] = await Promise.all([
    kv.get<{ locationDisplay?: string; customLocation?: string }>(OVERLAY_SETTINGS_KEY),
    kv.get<{ includeLocationInTitle?: boolean }>(KICK_STREAM_TITLE_SETTINGS_KEY),
    getPersistentLocation(),
    getCachedLocationData(true),
  ]);

  const includeLocationInTitle = streamTitleSettings?.includeLocationInTitle !== false;
  const locationDisplay = (overlaySettings?.locationDisplay as LocationDisplayMode) ?? 'city';
  const customLoc = (overlaySettings?.customLocation as string) ?? '';

  const locationData = cached?.location?.rawLocationData ?? persistent?.location;

  const locationPart = getStreamTitleLocationPart(
    locationData ?? null,
    locationDisplay,
    customLoc,
    includeLocationInTitle
  );

  // No text provided: set title to location only, or error if location is disabled
  if (!customPart) {
    if (!includeLocationInTitle) {
      return { handled: true, reply: 'Usage: !title Your title here (location in title is disabled)' };
    }
    if (!locationPart) {
      return { handled: true, reply: 'No location data available. Use !title Your title here' };
    }
  }

  const fullTitle = customPart ? buildStreamTitle(customPart, locationPart) : locationPart!;

  try {
    const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ stream_title: fullTitle }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { handled: true, reply: `Failed to update title: ${err.slice(0, 80)}` };
    }

    // Persist customTitle so admin UI and auto-push stay in sync
    const stored = await kv.get<Record<string, unknown>>(KICK_STREAM_TITLE_SETTINGS_KEY);
    const toSave = {
      customTitle: customPart,
      autoUpdateLocation: stored?.autoUpdateLocation ?? true,
      includeLocationInTitle: stored?.includeLocationInTitle ?? true,
    };
    await kv.set(KICK_STREAM_TITLE_SETTINGS_KEY, toSave);
  } catch (err) {
    return { handled: true, reply: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }

  return {
    handled: true,
    reply: `Stream title set to "${fullTitle}"`,
  };
}
