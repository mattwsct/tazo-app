/**
 * Wellness chat command responses (shared by Kick and Fossabot /api/chat)
 */

import {
  getWellnessData,
  getStepsSinceStreamStart,
  getDistanceSinceStreamStart,
  getHandwashingSinceStreamStart,
  getFlightsSinceStreamStart,
} from '@/utils/wellness-storage';
import { kmToMiles } from '@/utils/unit-conversions';

function formatDistance(km: number): string {
  const kmStr = String(Math.round(km));
  const mi = String(Math.round(kmToMiles(km)));
  return `${kmStr} km (${mi} mi)`;
}

export async function getWellnessStepsResponse(): Promise<string> {
  const steps = await getStepsSinceStreamStart();
  if (steps <= 0) return '👟 No step data this stream yet.';
  return `👟 ${steps.toLocaleString()} steps this stream`;
}

export async function getWellnessDistanceResponse(): Promise<string> {
  const km = await getDistanceSinceStreamStart();
  if (km <= 0) return '🚶 No walking/running distance this stream yet.';
  return `🚶 ${formatDistance(km)} walked/run this stream`;
}

export async function getWellnessStandResponse(): Promise<string> {
  const wellness = await getWellnessData();
  const h = wellness?.standHours ?? 0;
  if (h <= 0) return '🧍 No stand hours today yet.';
  return `🧍 ${h} stand hour${h === 1 ? '' : 's'} today`;
}

export async function getWellnessCaloriesResponse(): Promise<string> {
  const wellness = await getWellnessData();
  const active = wellness?.activeCalories ?? 0;
  const resting = wellness?.restingCalories ?? 0;
  const total = wellness?.totalCalories ?? active + resting;
  if (active <= 0 && resting <= 0) return '🔥 No calorie data today yet.';
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} active`);
  if (resting > 0) parts.push(`${resting} resting`);
  if (total > 0 && parts.length === 0) parts.push(`${total} total`);
  return `🔥 ${parts.join(', ')} cal today`;
}

export async function getWellnessFlightsResponse(): Promise<string> {
  const flights = await getFlightsSinceStreamStart();
  if (flights <= 0) return '🪜 No flights climbed this stream yet.';
  return `🪜 ${flights} flight${flights === 1 ? '' : 's'} climbed this stream`;
}

export async function getWellnessHandwashingResponse(): Promise<string> {
  const n = await getHandwashingSinceStreamStart();
  if (n <= 0) return '🧼 No hand washes recorded this stream yet.';
  return `🧼 ${n} hand wash${n === 1 ? '' : 'es'} this stream`;
}

export async function getWellnessHeartRateResponse(): Promise<string | null> {
  const wellness = await getWellnessData();
  const bpm = wellness?.heartRate ?? wellness?.restingHeartRate;
  if (bpm == null || bpm <= 0) return null;
  const label = wellness?.heartRate != null ? 'Apple Health' : 'resting';
  return `💓 ${bpm} bpm (${label})`;
}

export async function getWellnessWeightResponse(): Promise<string> {
  const wellness = await getWellnessData();
  const kg = wellness?.weightKg;
  if (kg == null || kg <= 0) return '⚖️ No weight data yet.';
  const lbs = (kg * 2.205).toFixed(1);
  return `⚖️ ${kg} kg (${lbs} lbs)`;
}

export async function getWellnessSummaryResponse(): Promise<string> {
  const [wellness, steps, distance, handwashing, flights] = await Promise.all([
    getWellnessData(),
    getStepsSinceStreamStart(),
    getDistanceSinceStreamStart(),
    getHandwashingSinceStreamStart(),
    getFlightsSinceStreamStart(),
  ]);

  const parts: string[] = [];
  if (steps > 0) parts.push(`👟 ${steps.toLocaleString()} steps`);
  if (distance > 0) parts.push(`🚶 ${formatDistance(distance)}`);
  if (flights > 0) parts.push(`🪜 ${flights} flight${flights === 1 ? '' : 's'}`);
  if (handwashing > 0) parts.push(`🧼 ${handwashing} wash${handwashing === 1 ? '' : 'es'}`);
  if ((wellness?.standHours ?? 0) > 0) parts.push(`🧍 ${wellness!.standHours} stand hr`);
  if ((wellness?.activeCalories ?? 0) > 0) parts.push(`🔥 ${wellness!.activeCalories} active cal`);
  if ((wellness?.heartRate ?? 0) > 0 || (wellness?.restingHeartRate ?? 0) > 0) {
    parts.push(`💓 ${wellness!.heartRate ?? wellness!.restingHeartRate} bpm`);
  }
  if ((wellness?.weightKg ?? 0) > 0) parts.push(`⚖️ ${wellness!.weightKg} kg`);

  if (parts.length === 0) return '📊 No wellness data yet.';
  return `📊 ${parts.join(' · ')}`;
}
