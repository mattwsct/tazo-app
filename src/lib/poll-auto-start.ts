/**
 * Auto-start location-based polls when stream is live and chat has been idle.
 * Used by poll-cleanup cron.
 */

import { kv } from '@vercel/kv';
import { getPollState, setPollState, getPollSettings } from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { getPersistentLocation } from '@/utils/location-cache';
import { getTravelData } from '@/utils/travel-data';
import { KICK_LAST_CHAT_MESSAGE_AT_KEY } from '@/types/poll';
import { KICK_API_BASE } from '@/lib/kick-api';
import type { PollState } from '@/types/poll';

/** Strip emoji from food labels so chat users can vote by typing the name (e.g. "ramen" not "🍜 ramen"). */
function stripEmojiFromLabel(str: string): string {
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const FOOD_POLL_QUESTIONS = [
  'Favorite local food?',
  'What should I try?',
  'Best local dish?',
] as const;

const MOOD_POSITIVE = ['Good', 'Hyped', 'Chill', 'Blessed', 'Pumped', 'Relaxed', 'Vibing', 'Living', 'Cozy'];
const MOOD_NEUTRAL = ['Hungry', 'Focused', 'Bored', 'Grinding', 'Tired', 'Sleepy'];
const MOOD_NEGATIVE = ['Stressed', 'Anxious', 'Chaotic', 'Struggling', 'Surviving'];

const MOOD_POLL_QUESTIONS = [
  'Tazo mood?',
  'Stream mood?',
  'Vibe check?',
] as const;

const ENERGY_POLL_QUESTIONS = ["Stream energy?", "Chat vibe?", "Energy level?"] as const;
const ENERGY_OPTIONS = ['High', 'Medium', 'Low', 'Chaotic', 'Chill'];

const SNACK_POLL_QUESTIONS = ["Best stream snack?", "What to munch?", "Snack vote?"] as const;
const SNACK_OPTIONS = ['Chips', 'Candy', 'Fruit', 'Pizza', 'Nothing'];

const MUSIC_POLL_QUESTIONS = ["Music vibe?", "Background music?", "Genre tonight?"] as const;
const MUSIC_OPTIONS = ['Chill', 'Hype', 'Lo-fi', 'Metal', 'Silence'];

const DRINK_POLL_QUESTIONS = ["What to drink?", "Drink vote?", "Beverage of choice?"] as const;
const DRINK_OPTIONS = ['Water', 'Coffee', 'Energy drink', 'Soda', 'Tea'];

/**
 * Build a random mood poll (no location needed). Five random simple mood words.
 * Takes at least one from each category (positive, neutral, negative).
 */
export async function buildRandomMoodPoll(): Promise<{
  question: string;
  options: { label: string; votes: number; voters: Record<string, number> }[];
} | null> {
  const categories = [MOOD_POSITIVE, MOOD_NEUTRAL, MOOD_NEGATIVE];
  if (categories.some((c) => c.length < 1)) return null;

  const pickOne = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]!;
  const picked: string[] = [];

  for (const cat of categories) {
    let w = pickOne(cat);
    while (picked.includes(w) && cat.length > 1) {
      w = pickOne(cat);
    }
    picked.push(w);
  }

  const remaining = [...MOOD_POSITIVE, ...MOOD_NEUTRAL, ...MOOD_NEGATIVE].filter((w) => !picked.includes(w));
  while (picked.length < 5 && remaining.length > 0) {
    const w = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]!;
    picked.push(w);
  }

  const options = shuffle(picked).map((label) => ({ label, votes: 0, voters: {} as Record<string, number> }));
  const question = MOOD_POLL_QUESTIONS[Math.floor(Math.random() * MOOD_POLL_QUESTIONS.length)]!;
  return { question, options };
}

/**
 * Build a random location-based food poll. Used by auto-start and by !poll with no args.
 * Returns null if not enough data (no location, < 2 foods).
 */
export async function buildRandomLocationPoll(): Promise<
  { question: string; options: { label: string; votes: number; voters: Record<string, number> }[] } | null
> {
  const persistent = await getPersistentLocation();
  const countryCode = persistent?.location?.countryCode ?? null;
  const { foods } = getTravelData(countryCode);
  if (foods.length < 2) return null;

  const question = FOOD_POLL_QUESTIONS[Math.floor(Math.random() * FOOD_POLL_QUESTIONS.length)]!;
  const picked = shuffle(foods).slice(0, Math.min(5, foods.length));
  const options = picked
    .map((raw) => {
      const label = stripEmojiFromLabel(raw);
      return label ? { label, votes: 0, voters: {} as Record<string, number> } : null;
    })
    .filter((o): o is { label: string; votes: number; voters: Record<string, number> } => o !== null);
  if (options.length < 2) return null;
  return { question, options };
}

function buildSimplePoll(
  questions: readonly string[],
  options: string[]
): { question: string; options: { label: string; votes: number; voters: Record<string, number> }[] } {
  const question = questions[Math.floor(Math.random() * questions.length)]!;
  const picked = shuffle([...options]).slice(0, Math.min(5, options.length));
  return {
    question,
    options: picked.map((label) => ({ label, votes: 0, voters: {} as Record<string, number> })),
  };
}

/**
 * Build a random poll (mood, food, hot take, snack, music, drink). Mood always works; food needs location.
 * Weighted mix for variety.
 */
export async function buildRandomPoll(): Promise<{
  question: string;
  options: { label: string; votes: number; voters: Record<string, number> }[];
} | null> {
  const persistent = await getPersistentLocation();
  const hasLocation = !!persistent?.location?.countryCode;
  const roll = Math.random();

  if (hasLocation && roll < 0.25) {
    return buildRandomLocationPoll();
  }
  if (roll < 0.45) {
    return buildRandomMoodPoll();
  }
  if (roll < 0.6) {
    return buildSimplePoll(ENERGY_POLL_QUESTIONS, ENERGY_OPTIONS);
  }
  if (roll < 0.75) {
    return buildSimplePoll(SNACK_POLL_QUESTIONS, SNACK_OPTIONS);
  }
  if (roll < 0.85) {
    return buildSimplePoll(MUSIC_POLL_QUESTIONS, MUSIC_OPTIONS);
  }
  if (roll < 0.95) {
    return buildSimplePoll(DRINK_POLL_QUESTIONS, DRINK_OPTIONS);
  }
  // Fallback: mood or food
  if (hasLocation) {
    const food = await buildRandomLocationPoll();
    if (food) return food;
  }
  return buildRandomMoodPoll();
}

/**
 * If auto-start is enabled, stream is live, no poll active, and chat idle for X min,
 * start a random poll (mood or food). Returns true if a poll was started.
 */
export async function tryAutoStartPoll(): Promise<boolean> {
  const settings = await getPollSettings();
  if (!settings.autoStartPollsEnabled || !settings.enabled) return false;

  const idleMinutes = Math.max(1, Math.min(30, settings.chatIdleMinutes ?? 5));
  const idleMs = idleMinutes * 60 * 1000;

  const [pollState, lastChatAt, accessToken] = await Promise.all([
    getPollState(),
    kv.get<number>(KICK_LAST_CHAT_MESSAGE_AT_KEY),
    getValidAccessToken(),
  ]);

  if (!accessToken) return false;
  if (pollState?.status === 'active') return false;
  if (pollState?.status === 'winner' && pollState.winnerDisplayUntil != null && Date.now() < pollState.winnerDisplayUntil) {
    return false;
  }

  const now = Date.now();
  const lastAt = typeof lastChatAt === 'number' ? lastChatAt : 0;
  if (now - lastAt < idleMs) return false;

  let isLive = false;
  try {
    const channelRes = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      const ch = (channelData.data ?? [])[0];
      isLive = !!(ch?.livestream?.is_live ?? ch?.is_live);
    }
  } catch { /* ignore */ }
  if (!isLive) return false;

  const built = await buildRandomPoll();
  if (!built) return false;

  const { question, options } = built;
  const newState: PollState = {
    id: `poll_${Date.now()}`,
    question,
    options,
    startedAt: Date.now(),
    durationSeconds: settings.durationSeconds,
    status: 'active',
  };
  await setPollState(newState);
  try {
    await sendKickChatMessage(accessToken, buildPollStartMessage(question, options, settings.durationSeconds));
  } catch { /* ignore */ }

  if (process.env.NODE_ENV === 'development') {
    console.log('[poll-auto-start] started', { question, optionsCount: options.length });
  }
  return true;
}
