/**
 * Auto-update the Kick stream title with current sub count/target.
 * Called fire-and-forget from webhook (on sub events and goal bumps).
 */

import { kv } from '@/lib/kv';
import { getValidAccessToken, KICK_API_BASE, KICK_STREAM_TITLE_SETTINGS_KEY } from '@/lib/kick-api';
import { buildStreamTitle, getStreamTitleLocationPart } from '@/utils/stream-title-utils';
import { getPersistentLocation } from '@/utils/location-cache';
import type { LocationDisplayMode } from '@/types/settings';

const OVERLAY_SETTINGS_KEY = 'overlay_settings';

interface StreamTitleSettings {
  customTitle?: string;
  includeLocationInTitle?: boolean;
}

interface OverlaySettingsPartial {
  locationDisplay?: string;
  customLocation?: string;
  showSubGoal?: boolean;
  showKicksGoal?: boolean;
}

/**
 * Reset stream title to location only (clear custom title). Called when stream ends.
 * Persists customTitle '' to KV and PATCHes Kick with title = location part only (no custom text).
 */
export async function resetStreamTitleToLocationOnly(): Promise<void> {
  try {
    const [token, overlaySettings, persistent] = await Promise.all([
      getValidAccessToken(),
      kv.get<OverlaySettingsPartial>(OVERLAY_SETTINGS_KEY),
      getPersistentLocation(),
    ]);
    if (!token) return;

    const stored = await kv.get<StreamTitleSettings>(KICK_STREAM_TITLE_SETTINGS_KEY);
    await kv.set(KICK_STREAM_TITLE_SETTINGS_KEY, {
      ...stored,
      customTitle: '',
      includeLocationInTitle: stored?.includeLocationInTitle ?? true,
      autoUpdateLocation: (stored as { autoUpdateLocation?: boolean })?.autoUpdateLocation ?? true,
    });

    const includeLocation = stored?.includeLocationInTitle !== false;
    const displayMode = ((overlaySettings?.locationDisplay ?? 'city') as LocationDisplayMode);
    const customLoc = overlaySettings?.customLocation ?? '';
    const locationPart = getStreamTitleLocationPart(
      persistent?.location ?? null,
      displayMode,
      customLoc,
      includeLocation
    );
    const newTitle = buildStreamTitle('', locationPart);
    if (!newTitle.trim()) return;

    await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ stream_title: newTitle }),
    });
  } catch (e) {
    console.warn('Failed to reset stream title to location only:', e);
  }
}

/**
 * Rebuild and PATCH the Kick stream title from current persistent location and settings.
 * Used when overlay has just updated location so title updates immediately without waiting for cron.
 * Fetches current title from Kick and only PATCHes when it differs (wrong/stale location → auto-correct).
 */
export async function pushStreamTitleFromLocation(): Promise<void> {
  try {
    const [token, streamTitleSettings, overlaySettings, persistent] = await Promise.all([
      getValidAccessToken(),
      kv.get<StreamTitleSettings>(KICK_STREAM_TITLE_SETTINGS_KEY),
      kv.get<OverlaySettingsPartial & { subGoalTarget?: number; kicksGoalTarget?: number }>(OVERLAY_SETTINGS_KEY),
      getPersistentLocation(),
    ]);
    if (!token) return;
    const autoUpdateLocation = (streamTitleSettings as { autoUpdateLocation?: boolean })?.autoUpdateLocation !== false;
    if (!autoUpdateLocation) return;
    if (!persistent?.location) return;

    const includeLocation = streamTitleSettings?.includeLocationInTitle !== false;
    const displayMode = ((overlaySettings?.locationDisplay ?? 'city') as LocationDisplayMode);
    const customLoc = overlaySettings?.customLocation ?? '';
    const locationPart = getStreamTitleLocationPart(
      persistent.location,
      displayMode,
      customLoc,
      includeLocation
    );
    if (!locationPart) return;

    const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
    let subInfo: { current: number; target: number } | undefined;
    let kicksInfo: { current: number; target: number } | undefined;
    if (overlaySettings?.showSubGoal || overlaySettings?.showKicksGoal) {
      const { getStreamGoals } = await import('@/utils/stream-goals-storage');
      const goals = await getStreamGoals();
      if (overlaySettings?.showSubGoal) {
        const subTarget = overlaySettings?.subGoalTarget ?? 5;
        subInfo = { current: goals.subs, target: subTarget };
      }
      if (overlaySettings?.showKicksGoal) {
        const kicksTarget = overlaySettings?.kicksGoalTarget ?? 5000;
        kicksInfo = { current: goals.kicks, target: kicksTarget };
      }
    }
    const newTitle = buildStreamTitle(customTitle, locationPart, subInfo, kicksInfo);
    if (!newTitle.trim()) return;

    // Only PATCH when current title differs (wrong/stale location → auto-correct to our known-good location)
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (channelRes.ok) {
      const data = await channelRes.json();
      const ch = (data.data ?? [])[0];
      const currentTitle = (ch?.stream_title ?? '').trim();
      if (currentTitle === newTitle.trim()) return; // Already correct, skip
    }

    await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ stream_title: newTitle }),
    });
  } catch (e) {
    console.warn('Failed to push stream title from location:', e);
  }
}

/**
 * Rebuild and PATCH the Kick stream title with the latest goal counts.
 * No-op if token is unavailable. Always rebuilds title — removing goals when both are hidden.
 */
export async function updateKickTitleGoals(
  subCurrent: number,
  subTarget: number,
  kicksCurrent = 0,
  kicksTarget = 0
): Promise<void> {
  try {
    const [token, streamTitleSettings, overlaySettings, persistent] = await Promise.all([
      getValidAccessToken(),
      kv.get<StreamTitleSettings>(KICK_STREAM_TITLE_SETTINGS_KEY),
      kv.get<OverlaySettingsPartial>(OVERLAY_SETTINGS_KEY),
      getPersistentLocation(),
    ]);

    if (!token) return;

    const includeLocation = streamTitleSettings?.includeLocationInTitle !== false;
    const displayMode = ((overlaySettings?.locationDisplay ?? 'city') as LocationDisplayMode);
    const customLoc = overlaySettings?.customLocation ?? '';
    const locationPart = getStreamTitleLocationPart(
      persistent?.location ?? null,
      displayMode,
      customLoc,
      includeLocation
    );
    const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
    const subInfo = overlaySettings?.showSubGoal && subTarget > 0
      ? { current: subCurrent, target: subTarget }
      : undefined;
    const kicksInfo = overlaySettings?.showKicksGoal && kicksTarget > 0
      ? { current: kicksCurrent, target: kicksTarget }
      : undefined;
    const newTitle = buildStreamTitle(customTitle, locationPart, subInfo, kicksInfo);

    await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ stream_title: newTitle }),
    });
  } catch {
    // Non-critical — title will sync on next location cron tick
  }
}
