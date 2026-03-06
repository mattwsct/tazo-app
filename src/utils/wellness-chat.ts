/**
 * Wellness chat command responses (shared by Kick and Fossabot /api/chat)
 * All metrics reflect today's totals from Health Auto Export (resets naturally at midnight).
 */

import { getWellnessData, getWellnessDataForDisplay, getMetricUpdatedAt } from '@/utils/wellness-storage';
import { kmToMiles } from '@/utils/unit-conversions';

function formatDataAge(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) return '';
  const sec = Math.floor((Date.now() - updatedAt) / 1000);
  if (sec < 60) return ' (just now)';
  if (sec < 3600) return ` (${Math.floor(sec / 60)}m ago)`;
  return ` (${Math.floor(sec / 3600)}h ago)`;
}

function formatHeight(cm: number): string {
  const totalInches = cm / 2.54;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches % 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${cm} cm (${feet}'${inches}")`;
}

function formatDistance(km: number): string {
  const kmStr = km.toFixed(1);
  const miStr = kmToMiles(km).toFixed(1);
  return `${kmStr} km (${miStr} mi)`;
}

export async function getWellnessStepsResponse(): Promise<string> {
  const wellness = await getWellnessDataForDisplay();
  const steps = wellness?.steps ?? 0;
  if (steps <= 0) return '👟 No step data yet today.';
  const age = formatDataAge(getMetricUpdatedAt(wellness, 'steps'));
  return `👟 ${steps.toLocaleString()} steps today${age}`;
}

export async function getWellnessDistanceResponse(): Promise<string> {
  const wellness = await getWellnessDataForDisplay();
  const km = wellness?.distanceKm ?? 0;
  if (km <= 0) return '🚶 No distance data yet today.';
  const age = formatDataAge(getMetricUpdatedAt(wellness, 'distanceKm'));
  return `🚶 ${formatDistance(km)} walked/run today${age}`;
}

export async function getWellnessCaloriesResponse(): Promise<string> {
  const wellness = await getWellnessDataForDisplay();
  const active = wellness?.activeCalories ?? 0;
  if (active <= 0) return '🔥 No calorie data yet today.';
  const age = formatDataAge(getMetricUpdatedAt(wellness, 'activeCalories'));
  return `🔥 ${active.toLocaleString()} active cal today${age}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s} sec` : `${m} min`;
}

export async function getWellnessHeartRateResponse(): Promise<string | null> {
  const wellness = await getWellnessData();
  const bpm = wellness?.heartRate ?? wellness?.restingHeartRate;
  if (bpm == null || bpm <= 0) return null;
  const label = wellness?.heartRate != null ? 'Apple Health' : 'resting';
  const age = formatDataAge(getMetricUpdatedAt(wellness, ['heartRate', 'restingHeartRate']));
  return `💓 ${bpm} bpm (${label})${age}`;
}

export async function getWellnessHeightResponse(): Promise<string> {
  const wellness = await getWellnessData();
  const heightCm = wellness?.heightCm;
  if (heightCm == null || heightCm <= 0) return '📏 No height data yet.';
  return `📏 ${formatHeight(heightCm)}`;
}

export async function getWellnessWeightResponse(): Promise<string> {
  const wellness = await getWellnessData();
  const kg = wellness?.weightKg;
  const bmi = wellness?.bodyMassIndex;
  const parts: string[] = [];
  if (kg != null && kg > 0) parts.push(`${kg} kg (${(kg * 2.205).toFixed(1)} lbs)`);
  if (bmi != null && bmi > 0) parts.push(`BMI ${bmi}`);
  if (parts.length === 0) return '⚖️ No weight data yet.';
  return `⚖️ ${parts.join(' · ')}`;
}

export async function getWellnessSummaryResponse(): Promise<string> {
  const wellness = await getWellnessDataForDisplay();
  const parts: string[] = [];
  const steps = wellness?.steps ?? 0;
  const distance = wellness?.distanceKm ?? 0;
  const active = wellness?.activeCalories ?? 0;
  if (steps > 0) parts.push(`👟 ${steps.toLocaleString()} steps`);
  if (distance > 0) parts.push(`🚶 ${formatDistance(distance)}`);
  if (active > 0) parts.push(`🔥 ${active.toLocaleString()} active cal`);
  const hasBody = (wellness?.heightCm ?? 0) > 0 || (wellness?.weightKg ?? 0) > 0 || (wellness?.bodyMassIndex ?? 0) > 0;
  if (hasBody) {
    const body: string[] = [];
    if (wellness!.heightCm) body.push(formatHeight(wellness!.heightCm));
    if (wellness!.weightKg) body.push(`${wellness!.weightKg} kg`);
    if (wellness!.bodyMassIndex) body.push(`BMI ${wellness!.bodyMassIndex}`);
    parts.push(`⚖️ ${body.join(' · ')}`);
  }
  if (parts.length === 0) return '📊 No wellness data yet today.';
  const age = formatDataAge(getMetricUpdatedAt(wellness, ['steps', 'distanceKm', 'activeCalories']));
  return `📊 ${parts.join(' · ')}${age}`;
}
