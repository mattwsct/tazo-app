/**
 * Blackjack game: gambling chips (separate from leaderboard points), per-user game state.
 * Commands: !deal <amount>, !hit, !stand. Chips and gambling leaderboard reset each stream.
 * New players start with 100 chips.
 */

import { kv } from '@vercel/kv';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';

const CHIPS_BALANCE_KEY = 'blackjack_chips';
const GAMBLING_LEADERBOARD_KEY = 'blackjack_leaderboard';
const DEAL_COOLDOWN_KEY = 'blackjack_deal_last_at';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000; // Auto-stand after 90s
const DEAL_COOLDOWN_MS = 15_000; // Min 15s between starting new hands
const STARTING_CHIPS = 100;
const MIN_BET = 1;
const MAX_BET = 50;

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
type Suit = (typeof SUITS)[number];
type Rank = (typeof RANKS)[number];
type Card = `${Rank}${Suit}`;

function cardValue(card: Card): number {
  const r = card.slice(0, -1) as Rank;
  if (r === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(r)) return 10;
  return parseInt(r, 10);
}

function handValue(cards: Card[]): { value: number; isSoft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    if (v === 11) aces++;
    total += v;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { value: total, isSoft: aces > 0 };
}

function shuffleDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardDisplay(card: Card): string {
  return card; // e.g. "K♥" "A♠"
}

function normalizeUser(username: string): string {
  return username.trim().toLowerCase();
}

export interface BlackjackGame {
  playerHand: Card[];
  dealerHand: Card[];
  deck: Card[];
  bet: number;
  status: 'playing' | 'stand' | 'bust' | 'blackjack' | 'dealer_turn';
  createdAt: number;
}

function gameKey(user: string): string {
  return `${ACTIVE_GAME_KEY_PREFIX}${user}`;
}

/** Get or create chips balance. New players start with STARTING_CHIPS. */
export async function getChips(username: string): Promise<number> {
  const user = normalizeUser(username);
  try {
    const bal = await kv.hget<number | string>(CHIPS_BALANCE_KEY, user);
    if (bal != null) {
      return typeof bal === 'string' ? parseInt(bal, 10) : Math.floor(bal);
    }
    await Promise.all([
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(STARTING_CHIPS) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: STARTING_CHIPS, member: user }),
    ]);
    return STARTING_CHIPS;
  } catch {
    return STARTING_CHIPS;
  }
}

/** Deduct chips (for bet). Returns false if insufficient. */
async function deductChips(user: string, amount: number): Promise<boolean> {
  const bal = await getChips(user);
  if (bal < amount) return false;
  const newBal = bal - amount;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return true;
}

/** Add chips (for win). */
async function addChips(user: string, amount: number): Promise<void> {
  const bal = await getChips(user);
  const newBal = bal + amount;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
}

/** Reset chips and gambling leaderboard on stream start. */
export async function resetGamblingOnStreamStart(): Promise<void> {
  try {
    await Promise.all([
      kv.del(CHIPS_BALANCE_KEY),
      kv.del(GAMBLING_LEADERBOARD_KEY),
      kv.del(DEAL_COOLDOWN_KEY),
    ]);
    console.log('[Blackjack] Chips and gambling leaderboard reset on stream start at', new Date().toISOString());
  } catch (e) {
    console.warn('[Blackjack] Failed to reset on stream start:', e);
  }
}

/** Get top N by chips (gambling leaderboard). Uses leaderboard display names for casing. */
export async function getGamblingLeaderboardTop(n: number): Promise<{ username: string; chips: number }[]> {
  try {
    const excluded = await getLeaderboardExclusions();
    const names = (await kv.hgetall<Record<string, string>>('leaderboard_display_names')) ?? {};
    const raw = await kv.zrange(GAMBLING_LEADERBOARD_KEY, 0, n + excluded.size + 20, { rev: true, withScores: true });
    if (!raw || !Array.isArray(raw)) return [];
    const result: { username: string; chips: number }[] = [];
    for (let i = 0; i < raw.length && result.length < n; i += 2) {
      const user = String(raw[i] ?? '').trim().toLowerCase();
      if (!user || excluded.has(user)) continue;
      result.push({
        username: names[user] ?? user,
        chips: Math.round(Number(raw[i + 1] ?? 0)),
      });
    }
    return result.filter((u) => !excluded.has(u.username.trim().toLowerCase()));
  } catch {
    return [];
  }
}

/** Get active game or null. */
export async function getActiveGame(username: string): Promise<BlackjackGame | null> {
  const user = normalizeUser(username);
  try {
    const raw = await kv.get<BlackjackGame>(gameKey(user));
    if (!raw) return null;
    const game = raw as BlackjackGame;
    if (Date.now() - game.createdAt > GAME_TIMEOUT_MS) {
      await kv.del(gameKey(user));
      return null;
    }
    return game;
  } catch {
    return null;
  }
}

/** Start a new hand. Returns message string. */
export async function deal(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🃏 Min bet is ${MIN_BET} chip${MIN_BET > 1 ? 's' : ''}. !deal <amount>`;

  const now = Date.now();
  const lastAtRaw = await kv.hget<number | string>(DEAL_COOLDOWN_KEY, user);
  const lastAt = typeof lastAtRaw === 'number' ? lastAtRaw : (typeof lastAtRaw === 'string' ? parseInt(lastAtRaw, 10) : 0);
  if (lastAt > 0 && now - lastAt < DEAL_COOLDOWN_MS) {
    const wait = Math.ceil((DEAL_COOLDOWN_MS - (now - lastAt)) / 1000);
    return `🃏 Wait ${wait}s before starting another hand.`;
  }

  const existing = await getActiveGame(username);
  if (existing) {
    const { value } = handValue(existing.playerHand);
    return `🃏 You're already in a hand (${existing.playerHand.map(cardDisplay).join(' ')} = ${value}). !hit or !stand`;
  }

  const hasChips = await deductChips(user, bet);
  if (!hasChips) {
    const chips = await getChips(user);
    return `🃏 Not enough chips. You have ${chips}. Use !chips to check balance.`;
  }

  const deck = shuffleDeck();
  const p1 = deck.pop()!;
  const p2 = deck.pop()!;
  const d1 = deck.pop()!;
  const d2 = deck.pop()!;

  const playerHand = [p1, p2];
  const dealerHand = [d1, d2];
  const playerVal = handValue(playerHand);

  if (playerVal.value === 21) {
    const dealerVal = handValue(dealerHand);
    if (dealerVal.value === 21) {
      await Promise.all([
        addChips(user, bet),
        kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) }),
      ]);
      return `🃏 Push! Both have 21. Bet returned.`;
    }
    const win = Math.floor(bet * 1.5);
    await Promise.all([
      addChips(user, bet + win),
      kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) }),
    ]);
    return `🃏 Blackjack! You win ${win} chips!`;
  }

  const game: BlackjackGame = {
    playerHand,
    dealerHand,
    deck,
    bet,
    status: 'playing',
    createdAt: Date.now(),
  };
  await Promise.all([
    kv.set(gameKey(user), game),
    kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) }),
  ]);

  const dealerVis = cardDisplay(d1) + ' ?';
  return `🃏 Your hand: ${playerHand.map(cardDisplay).join(' ')} (${playerVal.value}) | Dealer: ${dealerVis} | Bet: ${bet} — !hit or !stand`;
}

/** Hit - draw a card. */
export async function hit(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;

  const card = game.deck.pop()!;
  game.playerHand.push(card);
  const { value } = handValue(game.playerHand);

  if (value > 21) {
    await kv.del(gameKey(user));
    return `🃏 Bust! You got ${cardDisplay(card)} — ${game.playerHand.map(cardDisplay).join(' ')} = ${value}. Lost ${game.bet} chips.`;
  }

  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  return `🃏 Drew ${cardDisplay(card)}. Your hand: ${game.playerHand.map(cardDisplay).join(' ')} (${value}) — !hit or !stand`;
}

/** Stand - dealer plays. */
export async function stand(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;

  const dealerHand = [...game.dealerHand];
  const deck = [...game.deck];
  const playerVal = handValue(game.playerHand).value;

  while (handValue(dealerHand).value < 17) {
    const card = deck.pop()!;
    dealerHand.push(card);
  }

  const dealerVal = handValue(dealerHand).value;

  let result: string;
  if (dealerVal > 21) {
    const win = game.bet * 2;
    await addChips(user, win);
    result = `Dealer busts! You win ${game.bet} chips!`;
  } else if (dealerVal > playerVal) {
    result = `Dealer wins ${dealerVal} vs ${playerVal}. Lost ${game.bet} chips.`;
  } else if (dealerVal < playerVal) {
    const win = game.bet * 2;
    await addChips(user, win);
    result = `You win ${playerVal} vs ${dealerVal}! +${game.bet} chips.`;
  } else {
    await addChips(user, game.bet);
    result = `Push. Bet returned.`;
  }

  await kv.del(gameKey(user));
  return `🃏 Dealer: ${dealerHand.map(cardDisplay).join(' ')} (${dealerVal}) | ${result}`;
}
