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
const WELLNESS_DISTANCE_SESSION_KEY = 'wellness_distance_session';
const WELLNESS_HANDWASHING_SESSION_KEY = 'wellness_handwashing_session';
const WELLNESS_FLIGHTS_SESSION_KEY = 'wellness_flights_session';

export interface StepsSession {
  accumulated: number;  // steps since stream start (survives midnight)
  lastKnown: number;     // last raw steps from API (for delta calc / daily-reset detection)
}

export interface DistanceSession {
  accumulated: number;  // km since stream start (survives midnight)
  lastKnown: number;     // last raw distance from API (for delta calc / daily-reset detection)
}

export interface HandwashingSession {
  accumulated: number;  // handwashing events since stream start (survives midnight)
  lastKnown: number;
}

export interface FlightsSession {
  accumulated: number;  // flights climbed since stream start (survives midnight)
  lastKnown: number;
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
  handwashingCount?: number;  // Handwashing events (from Health Auto Export)
  weightKg?: number;         // Body mass in kg (from Health Auto Export)
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

// === Distance since stream start (handles daily midnight reset) ===

export async function getDistanceSession(): Promise<DistanceSession | null> {
  try {
    const data = await kv.get<DistanceSession>(WELLNESS_DISTANCE_SESSION_KEY);
    return data;
  } catch {
    return null;
  }
}

export async function getDistanceSinceStreamStart(): Promise<number> {
  const session = await getDistanceSession();
  return session?.accumulated ?? 0;
}

/** Call when stream goes live. Resets distance accumulator. */
export async function resetDistanceSession(currentDistanceKm: number): Promise<void> {
  try {
    const session: DistanceSession = {
      accumulated: 0,
      lastKnown: Math.max(0, currentDistanceKm),
    };
    await kv.set(WELLNESS_DISTANCE_SESSION_KEY, session);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Wellness] Distance session reset at stream start, baseline:', session.lastKnown, 'km');
    }
  } catch (error) {
    console.error('Failed to reset distance session:', error);
    throw error;
  }
}

/** Call on each wellness import when distance is present. Accumulates delta; treats newKm < lastKnown as daily reset. */
export async function updateDistanceSession(newDistanceKm: number): Promise<void> {
  try {
    const km = Math.max(0, newDistanceKm);
    const existing = await getDistanceSession();
    const lastKnown = existing?.lastKnown ?? 0;
    const accumulated = existing?.accumulated ?? 0;

    let delta: number;
    if (km >= lastKnown) {
      delta = km - lastKnown;
    } else {
      delta = km;  // Daily reset: new distance is today's count
    }

    const session: DistanceSession = {
      accumulated: Math.round((accumulated + delta) * 1000) / 1000,
      lastKnown: km,
    };
    await kv.set(WELLNESS_DISTANCE_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to update distance session:', error);
    throw error;
  }
}

// === Handwashing since stream start (handles daily midnight reset) ===

export async function getHandwashingSession(): Promise<HandwashingSession | null> {
  try {
    const data = await kv.get<HandwashingSession>(WELLNESS_HANDWASHING_SESSION_KEY);
    return data;
  } catch {
    return null;
  }
}

export async function getHandwashingSinceStreamStart(): Promise<number> {
  const session = await getHandwashingSession();
  return session?.accumulated ?? 0;
}

export async function resetHandwashingSession(currentCount: number): Promise<void> {
  try {
    const session: HandwashingSession = {
      accumulated: 0,
      lastKnown: Math.max(0, Math.floor(currentCount)),
    };
    await kv.set(WELLNESS_HANDWASHING_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to reset handwashing session:', error);
    throw error;
  }
}

export async function updateHandwashingSession(newCount: number): Promise<void> {
  try {
    const count = Math.max(0, Math.floor(newCount));
    const existing = await getHandwashingSession();
    const lastKnown = existing?.lastKnown ?? 0;
    const accumulated = existing?.accumulated ?? 0;

    let delta: number;
    if (count >= lastKnown) {
      delta = count - lastKnown;
    } else {
      delta = count;
    }

    const session: HandwashingSession = {
      accumulated: accumulated + delta,
      lastKnown: count,
    };
    await kv.set(WELLNESS_HANDWASHING_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to update handwashing session:', error);
    throw error;
  }
}

// === Flights climbed since stream start (handles daily midnight reset) ===

export async function getFlightsSession(): Promise<FlightsSession | null> {
  try {
    const data = await kv.get<FlightsSession>(WELLNESS_FLIGHTS_SESSION_KEY);
    return data;
  } catch {
    return null;
  }
}

export async function getFlightsSinceStreamStart(): Promise<number> {
  const session = await getFlightsSession();
  return session?.accumulated ?? 0;
}

export async function resetFlightsSession(currentFlights: number): Promise<void> {
  try {
    const session: FlightsSession = {
      accumulated: 0,
      lastKnown: Math.max(0, Math.floor(currentFlights)),
    };
    await kv.set(WELLNESS_FLIGHTS_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to reset flights session:', error);
    throw error;
  }
}

export async function updateFlightsSession(newFlights: number): Promise<void> {
  try {
    const count = Math.max(0, Math.floor(newFlights));
    const existing = await getFlightsSession();
    const lastKnown = existing?.lastKnown ?? 0;
    const accumulated = existing?.accumulated ?? 0;
    const delta = count >= lastKnown ? count - lastKnown : count;
    const session: FlightsSession = { accumulated: accumulated + delta, lastKnown: count };
    await kv.set(WELLNESS_FLIGHTS_SESSION_KEY, session);
  } catch (error) {
    console.error('Failed to update flights session:', error);
    throw error;
  }
}

// === Wellness milestones (reset on stream start) ===

const WELLNESS_MILESTONES_LAST_SENT_KEY = 'wellness_milestones_last_sent';

export interface WellnessMilestonesLastSent {
  steps?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  standHours?: number;
  activeCalories?: number;
  handwashing?: number;
}

export async function getWellnessMilestonesLastSent(): Promise<WellnessMilestonesLastSent> {
  try {
    const data = await kv.get<WellnessMilestonesLastSent>(WELLNESS_MILESTONES_LAST_SENT_KEY);
    return data ?? {};
  } catch {
    return {};
  }
}

export async function resetWellnessMilestonesOnStreamStart(): Promise<void> {
  try {
    await kv.del(WELLNESS_MILESTONES_LAST_SENT_KEY);
  } catch (error) {
    console.error('Failed to reset wellness milestones:', error);
  }
}

export async function setWellnessMilestoneLastSent(
  metric: keyof WellnessMilestonesLastSent,
  value: number
): Promise<void> {
  try {
    const current = await getWellnessMilestonesLastSent();
    await kv.set(WELLNESS_MILESTONES_LAST_SENT_KEY, { ...current, [metric]: value });
  } catch (error) {
    console.error('Failed to set wellness milestone last sent:', error);
  }
}
