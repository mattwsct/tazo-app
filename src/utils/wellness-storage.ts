// === 🏃 WELLNESS STORAGE ===
// Human health data from Health Auto Export (steps, calories, sleep, etc.)
// Separate from stats (stream-session speed/altitude/heart rate from Pulsoid/RTIRL)
//
// Steps session: Tracks steps accumulated since stream start, surviving daily resets.
// Health Auto Export sends daily step count that resets at midnight — we accumulate deltas
// and reset only when stream goes live.

import { kv } from '@vercel/kv';

const WELLNESS_KEY = 'wellness_data';
const WELLNESS_STEPS_SESSION_KEY = 'wellness_steps_session';

export interface StepsSession {
  accumulated: number;  // steps since stream start (survives midnight)
  lastKnown: number;     // last raw steps from API (for delta calc / daily-reset detection)
}

export interface WellnessData {
  steps?: number;
  activeCalories?: number;
  restingCalories?: number;
  totalCalories?: number;
  sleepHours?: number;
  sleepStart?: string;
  sleepEnd?: string;
  distanceKm?: number;
  flightsClimbed?: number;
  standHours?: number;
  heartRate?: number;        // From Apple Health (resting etc) — live BPM stays in stats from Pulsoid
  restingHeartRate?: number;
  hrv?: number;              // Heart rate variability (ms)
  updatedAt: number;
}

export async function getWellnessData(): Promise<WellnessData | null> {
  try {
    const data = await kv.get<WellnessData>(WELLNESS_KEY);
    return data;
  } catch {
    return null;
  }
}

export async function updateWellnessData(updates: Partial<WellnessData>): Promise<void> {
  try {
    const existing = await kv.get<WellnessData>(WELLNESS_KEY);
    const now = Date.now();
    const merged: WellnessData = {
      ...(existing || {}),
      ...updates,
      updatedAt: now,
    };
    await kv.set(WELLNESS_KEY, merged);
  } catch (error) {
    console.error('Failed to update wellness data:', error);
    throw error;
  }
}

// === Steps since stream start (handles daily midnight reset) ===

export async function getStepsSession(): Promise<StepsSession | null> {
  try {
    const data = await kv.get<StepsSession>(WELLNESS_STEPS_SESSION_KEY);
    return data;
  } catch {
    return null;
  }
}

export async function getStepsSinceStreamStart(): Promise<number> {
  const session = await getStepsSession();
  return session?.accumulated ?? 0;
}

/** Call when stream goes live. Resets accumulator; uses current steps as new baseline so we don't count pre-stream steps. */
export async function resetStepsSession(currentSteps: number): Promise<void> {
  try {
    const session: StepsSession = {
      accumulated: 0,
      lastKnown: Math.max(0, Math.floor(currentSteps)),
    };
    await kv.set(WELLNESS_STEPS_SESSION_KEY, session);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Wellness] Steps session reset at stream start, baseline:', session.lastKnown);
    }
  } catch (error) {
    console.error('Failed to reset steps session:', error);
    throw error;
  }
}

/** Call on each wellness import when steps are present. Accumulates delta; treats newSteps < lastKnown as daily reset. */
export async function updateStepsSession(newSteps: number): Promise<void> {
  try {
    const steps = Math.max(0, Math.floor(newSteps));
    const existing = await getStepsSession();
    const lastKnown = existing?.lastKnown ?? 0;
    const accumulated = existing?.accumulated ?? 0;

    let delta: number;
    if (steps >= lastKnown) {
      delta = steps - lastKnown;
    } else {
      // Daily reset: newSteps is today's count; add it as fresh contribution
      delta = steps;
    }

    const session: StepsSession = {
      accumulated: accumulated + delta,
      lastKnown: steps,
    };
    await kv.set(WELLNESS_STEPS_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to update steps session:', error);
    throw error;
  }
}
