/**
 * Auto-update the Kick stream title with current sub count/target.
 * Called fire-and-forget from webhook (on sub events) and bump-goal (after increment).
 */

import { kv } from '@vercel/kv';
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
  showSubCountInTitle?: boolean;
}

/**
 * Rebuild and PATCH the Kick stream title with the latest sub count/target.
 * No-op if showSubCountInTitle is off or token is unavailable.
 */
export async function updateKickTitleSubCount(
  subCurrent: number,
  subTarget: number
): Promise<void> {
  try {
    const [token, streamTitleSettings, overlaySettings, persistent] = await Promise.all([
      getValidAccessToken(),
      kv.get<StreamTitleSettings>(KICK_STREAM_TITLE_SETTINGS_KEY),
      kv.get<OverlaySettingsPartial>(OVERLAY_SETTINGS_KEY),
      getPersistentLocation(),
    ]);

    if (!token || !overlaySettings?.showSubCountInTitle) return;

    const includeLocation = streamTitleSettings?.includeLocationInTitle !== false;
    const displayMode = (overlaySettings.locationDisplay as LocationDisplayMode) ?? 'city';
    const customLoc = overlaySettings.customLocation ?? '';
    const locationPart = getStreamTitleLocationPart(
      persistent?.location ?? null,
      displayMode,
      customLoc,
      includeLocation
    );
    const customTitle = (streamTitleSettings?.customTitle ?? '').trim();
    const newTitle = buildStreamTitle(customTitle, locationPart, { current: subCurrent, target: subTarget });

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
