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

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s} sec` : `${m} min`;
}

export async function getWellnessHandwashingResponse(): Promise<string> {
  const sec = await getHandwashingSinceStreamStart();
  if (sec <= 0) return '🧼 No handwashing time recorded this stream yet.';
  return `🧼 ${formatDuration(sec)} handwashing this stream`;
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
  const bmi = wellness?.bodyMassIndex;
  const bodyFat = wellness?.bodyFatPercent;
  const leanKg = wellness?.leanBodyMassKg;
  const parts: string[] = [];
  if (kg != null && kg > 0) parts.push(`${kg} kg (${(kg * 2.205).toFixed(1)} lbs)`);
  if (bmi != null && bmi > 0) parts.push(`BMI ${bmi}`);
  if (bodyFat != null && bodyFat > 0) parts.push(`Body fat ${bodyFat}%`);
  if (leanKg != null && leanKg > 0) parts.push(`Lean ${leanKg} kg`);
  if (parts.length === 0) return '⚖️ No weight data yet.';
  return `⚖️ ${parts.join(' · ')}`;
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
  if (handwashing > 0) parts.push(`🧼 ${formatDuration(handwashing)} handwashing`);
  if ((wellness?.standHours ?? 0) > 0) parts.push(`🧍 ${wellness!.standHours} stand hr`);
  if ((wellness?.activeCalories ?? 0) > 0) parts.push(`🔥 ${wellness!.activeCalories} active cal`);
  if ((wellness?.heartRate ?? 0) > 0 || (wellness?.restingHeartRate ?? 0) > 0) {
    parts.push(`💓 ${wellness!.heartRate ?? wellness!.restingHeartRate} bpm`);
  }
  const hasBody = (wellness?.weightKg ?? 0) > 0 || (wellness?.bodyMassIndex ?? 0) > 0 || (wellness?.bodyFatPercent ?? 0) > 0 || (wellness?.leanBodyMassKg ?? 0) > 0;
  if (hasBody) {
    const body: string[] = [];
    if (wellness!.weightKg) body.push(`${wellness!.weightKg} kg`);
    if (wellness!.bodyMassIndex) body.push(`BMI ${wellness!.bodyMassIndex}`);
    if (wellness!.bodyFatPercent) body.push(`${wellness!.bodyFatPercent}% fat`);
    if (wellness!.leanBodyMassKg) body.push(`lean ${wellness!.leanBodyMassKg} kg`);
    parts.push(`⚖️ ${body.join(' · ')}`);
  }

  if (parts.length === 0) return '📊 No wellness data yet.';
  return `📊 ${parts.join(' · ')}`;
}
