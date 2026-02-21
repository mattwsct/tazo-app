/**
 * Auto-start location-based polls when stream is live and no poll run in X minutes.
 * Used by poll-cleanup cron.
 */

import { kv } from '@vercel/kv';
import { getPollState, setPollState, getPollSettings } from '@/lib/poll-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { buildPollStartMessage } from '@/lib/poll-webhook-handler';
import { getPersistentLocation } from '@/utils/location-cache';
import { pickOne } from '@/utils/chat-utils';
import { getTravelData } from '@/utils/travel-data';
import { LAST_POLL_ENDED_AT_KEY } from '@/types/poll';
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

const VIDEO_GAME_CHARACTER_QUESTIONS = ["Best video game character?", "GOAT game character?", "Favorite game character ever?"] as const;
const VIDEO_GAME_CHARACTER_OPTIONS = ['Mario', 'Link', 'Sonic', 'Pikachu', 'Master Chief', 'Lara Croft', 'Kratos', 'Samus', 'Kirby', 'Donkey Kong', 'Pac-Man', 'Crash', 'Spyro', 'Cloud', 'Solid Snake', 'Nathan Drake', 'Ellie', 'Arthur Morgan'];

const VIDEO_GAME_FRANCHISE_QUESTIONS = ["Best video game franchise?", "GOAT game series?", "Favorite game franchise?"] as const;
const VIDEO_GAME_FRANCHISE_OPTIONS = ['Zelda', 'Mario', 'Pokemon', 'Halo', 'Final Fantasy', 'Minecraft', 'GTA', 'Elden Ring', 'Dark Souls', 'Metal Gear', 'Uncharted', 'The Last of Us', 'Red Dead', 'Assassins Creed', 'Resident Evil', 'God of War'];

const SUPERHERO_QUESTIONS = ["Best superhero?", "GOAT superhero?", "Favorite superhero ever?"] as const;
const SUPERHERO_OPTIONS = ['Batman', 'Superman', 'Spider-Man', 'Iron Man', 'Wonder Woman', 'Thor', 'Captain America', 'Wolverine', 'Deadpool', 'Black Panther', 'Hulk', 'Flash', 'Green Lantern', 'Aquaman', 'Doctor Strange'];

const CARTOON_QUESTIONS = ["Best cartoon?", "Favorite cartoon ever?", "GOAT cartoon show?"] as const;
const CARTOON_OPTIONS = ['SpongeBob', 'Simpsons', 'Avatar', 'Adventure Time', 'Rick and Morty', 'Gravity Falls', 'Regular Show', 'Courage', 'Dragon Ball', 'One Piece', 'Naruto', 'Cowboy Bebop', 'Arcane', 'Invincible'];

const MOVIE_GENRE_QUESTIONS = ["Best movie genre?", "Movie night genre?", "Favorite film genre?"] as const;
const MOVIE_GENRE_OPTIONS = ['Action', 'Comedy', 'Horror', 'Sci-fi', 'Romance', 'Thriller', 'Animation', 'Documentary'];

const PIZZA_TOPPING_QUESTIONS = ["Best pizza topping?", "Pizza vote?", "Favorite pizza topping?"] as const;
const PIZZA_TOPPING_OPTIONS = ['Pepperoni', 'Mushrooms', 'Olives', 'Ham', 'Pineapple', 'Sausage', 'Bacon', 'Extra cheese', 'Onions', 'Bell peppers', 'Jalapeños', 'BBQ chicken'];

const PET_QUESTIONS = ["Best pet?", "Favorite pet?", "Pet of choice?"] as const;
const PET_OPTIONS = ['Dog', 'Cat', 'Fish', 'Bird', 'Hamster', 'Snake', 'Lizard', 'Rabbit'];

const SEASON_QUESTIONS = ["Best season?", "Favorite season?", "Season vibe?"] as const;
const SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter'];

const CONSOLE_QUESTIONS = ["Best gaming console?", "Favorite console?", "Console of choice?"] as const;
const CONSOLE_OPTIONS = ['PlayStation', 'Xbox', 'Nintendo Switch', 'PC', 'Steam Deck'];

const ANIME_CHARACTER_QUESTIONS = ["Best anime character?", "Favorite anime character?", "GOAT anime character?"] as const;
const ANIME_CHARACTER_OPTIONS = ['Goku', 'Luffy', 'Naruto', 'Edward', 'Spike', 'Light', 'L', 'Eren', 'Levi', 'Saitama', 'Gon', 'Midoriya', 'Tanjiro'];

const STREAMING_SERVICE_QUESTIONS = ["Best streaming service?", "Where to watch?", "Streaming pick?"] as const;
const STREAMING_SERVICE_OPTIONS = ['Netflix', 'Disney+', 'Prime', 'HBO Max', 'Crunchyroll', 'YouTube'];

const FANTASY_CREATURE_QUESTIONS = ["Best fantasy creature?", "Favorite mythical creature?", "Fantasy creature pick?"] as const;
const FANTASY_CREATURE_OPTIONS = ['Dragon', 'Phoenix', 'Unicorn', 'Griffin', 'Hydra', 'Pegasus', 'Mermaid', 'Vampire', 'Werewolf'];

const BREAKFAST_QUESTIONS = ["Best breakfast food?", "Breakfast vote?", "Favorite morning food?"] as const;
const BREAKFAST_OPTIONS = ['Eggs', 'Pancakes', 'Waffles', 'Bacon', 'Cereal', 'Toast', 'Oatmeal', 'French toast', 'Bagel'];

const SPORT_QUESTIONS = ["Best sport?", "Favorite sport to watch?", "Sport of choice?"] as const;
const SPORT_OPTIONS = ['Soccer', 'Basketball', 'Football', 'Baseball', 'Hockey', 'Tennis', 'Golf', 'Esports'];

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

  const picked: string[] = [];

  for (const cat of categories) {
    let w = pickOne(cat) ?? cat[0]!;
    while (picked.includes(w) && cat.length > 1) {
      w = pickOne(cat) ?? cat[0]!;
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

/** All simple poll types (question sets + option sets). Picked randomly for variety. */
const SIMPLE_POLL_TYPES: Array<{ questions: readonly string[]; options: string[] }> = [
  { questions: ENERGY_POLL_QUESTIONS, options: ENERGY_OPTIONS },
  { questions: SNACK_POLL_QUESTIONS, options: SNACK_OPTIONS },
  { questions: MUSIC_POLL_QUESTIONS, options: MUSIC_OPTIONS },
  { questions: DRINK_POLL_QUESTIONS, options: DRINK_OPTIONS },
  { questions: VIDEO_GAME_CHARACTER_QUESTIONS, options: VIDEO_GAME_CHARACTER_OPTIONS },
  { questions: VIDEO_GAME_FRANCHISE_QUESTIONS, options: VIDEO_GAME_FRANCHISE_OPTIONS },
  { questions: SUPERHERO_QUESTIONS, options: SUPERHERO_OPTIONS },
  { questions: CARTOON_QUESTIONS, options: CARTOON_OPTIONS },
  { questions: MOVIE_GENRE_QUESTIONS, options: MOVIE_GENRE_OPTIONS },
  { questions: PIZZA_TOPPING_QUESTIONS, options: PIZZA_TOPPING_OPTIONS },
  { questions: PET_QUESTIONS, options: PET_OPTIONS },
  { questions: SEASON_QUESTIONS, options: SEASON_OPTIONS },
  { questions: CONSOLE_QUESTIONS, options: CONSOLE_OPTIONS },
  { questions: ANIME_CHARACTER_QUESTIONS, options: ANIME_CHARACTER_OPTIONS },
  { questions: STREAMING_SERVICE_QUESTIONS, options: STREAMING_SERVICE_OPTIONS },
  { questions: FANTASY_CREATURE_QUESTIONS, options: FANTASY_CREATURE_OPTIONS },
  { questions: BREAKFAST_QUESTIONS, options: BREAKFAST_OPTIONS },
  { questions: SPORT_QUESTIONS, options: SPORT_OPTIONS },
];

/**
 * Build a random poll (mood, food, video games, superheroes, cartoons, snacks, etc.).
 * Mood and location-food get higher weight; others distributed evenly.
 */
export async function buildRandomPoll(): Promise<{
  question: string;
  options: { label: string; votes: number; voters: Record<string, number> }[];
} | null> {
  const persistent = await getPersistentLocation();
  const hasLocation = !!persistent?.location?.countryCode;
  const roll = Math.random();

  if (hasLocation && roll < 0.2) {
    return buildRandomLocationPoll();
  }
  if (roll < 0.35) {
    return buildRandomMoodPoll();
  }
  const simple = SIMPLE_POLL_TYPES[Math.floor(Math.random() * SIMPLE_POLL_TYPES.length)]!;
  if (roll < 0.95) {
    return buildSimplePoll(simple.questions, simple.options);
  }
  if (hasLocation) {
    const food = await buildRandomLocationPoll();
    if (food) return food;
  }
  return buildRandomMoodPoll();
}

/**
 * If auto-start is enabled, stream is live, no poll active, and no poll run in X min,
 * start a random poll (mood or food). Returns true if a poll was started.
 */
export async function tryAutoStartPoll(): Promise<boolean> {
  const settings = await getPollSettings();
  if (!settings.autoStartPollsEnabled || !settings.enabled) return false;

  const minutesSinceLast = Math.max(1, Math.min(30, settings.minutesSinceLastPoll ?? 5));
  const minGapMs = minutesSinceLast * 60 * 1000;

  const [pollState, lastPollEndedAt, accessToken] = await Promise.all([
    getPollState(),
    kv.get<number>(LAST_POLL_ENDED_AT_KEY),
    getValidAccessToken(),
  ]);

  if (!accessToken) return false;
  if (pollState?.status === 'active') return false;
  if (pollState?.status === 'winner' && pollState.winnerDisplayUntil != null && Date.now() < pollState.winnerDisplayUntil) {
    return false;
  }

  const now = Date.now();
  const lastAt = typeof lastPollEndedAt === 'number' ? lastPollEndedAt : 0;
  if (lastAt > 0 && now - lastAt < minGapMs) return false;

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
