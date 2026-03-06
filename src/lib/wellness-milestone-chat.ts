/**
 * Shared wellness milestone chat logic.
 * Used by the cron (every minute) and by the wellness import route (immediately when new data arrives).
 */

import { kv } from '@/lib/kv';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { isStreamLive } from '@/utils/stats-storage';
import {
  getWellnessDataForDisplay,
  getWellnessMilestonesLastSent,
  setWellnessMilestoneLastSent,
} from '@/utils/wellness-storage';
import { KICK_ALERT_SETTINGS_KEY } from '@/types/kick-messages';
import { DEFAULT_KICK_ALERT_SETTINGS } from '@/app/api/kick-messages/route';

export const WELLNESS_MILESTONES = {
  steps: [
    1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000,
    11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000,
    22000, 24000, 26000, 28000, 30000, 35000, 40000, 50000, 75000, 100000,
  ],
  distanceKm: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    22, 24, 26, 28, 30, 35, 40, 50, 75, 100,
  ],
  activeCalories: [100, 250, 500, 1000, 1500, 2000, 3000, 5000],
} as const;

type MetricKey = 'steps' | 'distanceKm' | 'activeCalories';

/**
 * Check current wellness values against milestones and send Kick chat messages for newly crossed milestones.
 * Call after wellness import or from cron. Only runs when stream is live and Kick token is available.
 * @returns Number of chat messages sent
 */
export async function checkWellnessMilestonesAndSendChat(): Promise<number> {
  const [token, live] = await Promise.all([
    getValidAccessToken(),
    isStreamLive(),
  ]);
  if (!token) {
    console.log('[Wellness Milestones] Skip: no Kick token');
    return 0;
  }
  if (!live) {
    console.log('[Wellness Milestones] Skip: stream not live');
    return 0;
  }

  const storedAlertRaw = await kv.get<Record<string, unknown>>(KICK_ALERT_SETTINGS_KEY);
  const storedAlert = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlertRaw } as Record<string, unknown>;

  const wellnessStepsOn = storedAlert?.chatBroadcastWellnessSteps !== false;
  const wellnessDistanceOn = storedAlert?.chatBroadcastWellnessDistance !== false;
  const wellnessCaloriesOn = storedAlert?.chatBroadcastWellnessActiveCalories === true;
  if (!wellnessStepsOn && !wellnessDistanceOn && !wellnessCaloriesOn) return 0;

  const [wellnessData, milestonesLast] = await Promise.all([
    getWellnessDataForDisplay(),
    getWellnessMilestonesLastSent(),
  ]);
  const stepsSince = wellnessData?.steps ?? 0;
  const distanceSince = wellnessData?.distanceKm ?? 0;
  const activeCalSince = wellnessData?.activeCalories ?? 0;

  let sent = 0;

  const checkAndSend = async (
    toggle: boolean | undefined,
    current: number,
    milestones: readonly number[],
    lastSent: number | undefined,
    metric: MetricKey,
    emoji: string,
    label: string,
    fmtDisplay: (n: number) => string
  ): Promise<void> => {
    if (!toggle || current <= 0) return;
    if (lastSent != null && lastSent > 0 && current < lastSent) {
      await setWellnessMilestoneLastSent(metric, 0);
      lastSent = undefined;
    }
    const crossed = milestones.filter((m) => current >= m && (lastSent == null || m > lastSent));
    const highest = crossed.length > 0 ? Math.max(...crossed) : null;
    if (highest != null) {
      const msg = `${emoji} ${label}: ${fmtDisplay(current)}`;
      try {
        await sendKickChatMessage(token, msg);
        sent++;
        await setWellnessMilestoneLastSent(metric, highest);
      } catch {
        // ignore per-metric send failure
      }
    }
  };

  await checkAndSend(
    wellnessStepsOn,
    stepsSince,
    WELLNESS_MILESTONES.steps,
    milestonesLast.steps,
    'steps',
    '👟',
    'Step count',
    (n) => n.toLocaleString('en-US')
  );
  await checkAndSend(
    wellnessDistanceOn,
    distanceSince,
    WELLNESS_MILESTONES.distanceKm,
    milestonesLast.distanceKm,
    'distanceKm',
    '🚶',
    'Distance',
    (n) => `${n.toFixed(1)} km`
  );
  await checkAndSend(
    wellnessCaloriesOn,
    activeCalSince,
    WELLNESS_MILESTONES.activeCalories,
    milestonesLast.activeCalories,
    'activeCalories',
    '🔥',
    'Active calories',
    (n) => n.toLocaleString('en-US')
  );

  return sent;
}
