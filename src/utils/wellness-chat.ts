/**
 * Wellness chat command responses (shared by Kick and Fossabot /api/chat)
 */

import {
  getWellnessData,
  getStepsSinceStreamStart,
  getDistanceSinceStreamStart,
  getFlightsSinceStreamStart,
  getActiveCaloriesSinceStreamStart,
  getMetricUpdatedAt,
  getLastSessionMetricUpdateAt,
} from '@/utils/wellness-storage';
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
  const [steps, wellness, sessionAt] = await Promise.all([
    getStepsSinceStreamStart(),
    getWellnessData(),
    getLastSessionMetricUpdateAt('steps'),
  ]);
  if (steps <= 0) return '👟 No step data this stream yet.';
  const age = formatDataAge(sessionAt || getMetricUpdatedAt(wellness, 'steps'));
  return `👟 ${steps.toLocaleString()} steps this stream${age}`;
}

export async function getWellnessDistanceResponse(): Promise<string> {
  const [km, wellness, sessionAt] = await Promise.all([
    getDistanceSinceStreamStart(),
    getWellnessData(),
    getLastSessionMetricUpdateAt('distanceKm'),
  ]);
  if (km <= 0) return '🚶 No walking/running distance this stream yet.';
  const age = formatDataAge(sessionAt || getMetricUpdatedAt(wellness, 'distanceKm'));
  return `🚶 ${formatDistance(km)} walked/run this stream${age}`;
}

export async function getWellnessCaloriesResponse(): Promise<string> {
  const [wellness, activeSince, sessionAt] = await Promise.all([
    getWellnessData(),
    getActiveCaloriesSinceStreamStart(),
    getLastSessionMetricUpdateAt('activeCalories'),
  ]);
  const resting = wellness?.restingCalories ?? 0;
  const total = wellness?.totalCalories;
  if (activeSince <= 0 && resting <= 0) return '🔥 No calorie data this stream yet.';
  const parts: string[] = [];
  if (activeSince > 0) parts.push(`${activeSince} active cal (stream)`);
  if (resting > 0) parts.push(`${resting} resting cal (today)`);
  if ((total ?? 0) > 0 && parts.length === 0) parts.push(`${total} total cal`);
  const age = formatDataAge(
    sessionAt || getMetricUpdatedAt(wellness, ['activeCalories', 'restingCalories', 'totalCalories'])
  );
  return `🔥 ${parts.join(' · ')}${age}`;
}

export async function getWellnessFlightsResponse(): Promise<string> {
  const [flights, wellness, sessionAt] = await Promise.all([
    getFlightsSinceStreamStart(),
    getWellnessData(),
    getLastSessionMetricUpdateAt('flightsClimbed'),
  ]);
  if (flights <= 0) return '🪜 No flights climbed this stream yet.';
  const age = formatDataAge(sessionAt || getMetricUpdatedAt(wellness, 'flightsClimbed'));
  return `🪜 ${flights} flight${flights === 1 ? '' : 's'} climbed this stream${age}`;
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
  const [wellness, steps, distance, flights, activeSince, stepsAt, distanceAt, flightsAt, caloriesAt] =
    await Promise.all([
      getWellnessData(),
      getStepsSinceStreamStart(),
      getDistanceSinceStreamStart(),
      getFlightsSinceStreamStart(),
      getActiveCaloriesSinceStreamStart(),
      getLastSessionMetricUpdateAt('steps'),
      getLastSessionMetricUpdateAt('distanceKm'),
      getLastSessionMetricUpdateAt('flightsClimbed'),
      getLastSessionMetricUpdateAt('activeCalories'),
    ]);

  const parts: string[] = [];
  if (steps > 0) parts.push(`👟 ${steps.toLocaleString()} steps`);
  if (distance > 0) parts.push(`🚶 ${formatDistance(distance)}`);
  if (flights > 0) parts.push(`🪜 ${flights} flight${flights === 1 ? '' : 's'}`);
  if (activeSince > 0) parts.push(`🔥 ${activeSince} active cal`);
  if ((wellness?.heartRate ?? 0) > 0 || (wellness?.restingHeartRate ?? 0) > 0) {
    parts.push(`💓 ${wellness!.heartRate ?? wellness!.restingHeartRate} bpm`);
  }
  const hasBody = (wellness?.heightCm ?? 0) > 0 || (wellness?.weightKg ?? 0) > 0 || (wellness?.bodyMassIndex ?? 0) > 0;
  if (hasBody) {
    const body: string[] = [];
    if (wellness!.heightCm) body.push(formatHeight(wellness!.heightCm));
    if (wellness!.weightKg) body.push(`${wellness!.weightKg} kg`);
    if (wellness!.bodyMassIndex) body.push(`BMI ${wellness!.bodyMassIndex}`);
    parts.push(`⚖️ ${body.join(' · ')}`);
  }

  if (parts.length === 0) return '📊 No wellness data yet.';
  const sessionMax = Math.max(stepsAt, distanceAt, flightsAt, caloriesAt);
  const wellnessMax = getMetricUpdatedAt(wellness, [
    'steps', 'distanceKm', 'flightsClimbed', 'activeCalories', 'heartRate', 'restingHeartRate',
  ]);
  const age = formatDataAge(sessionMax || wellnessMax);
  return `📊 ${parts.join(' · ')}${age}`;
}
