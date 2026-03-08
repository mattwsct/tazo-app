/**
 * Persistent Credits and blackjack only.
 * Credits: persistent across streams, new users start with 0. Earn via Sub (+100), Gift sub (+100), Kicks (+1), !addcredits.
 * Blackjack: !bj <amount>, !deal, !hit, !stand, !double, !split.
 * Stream start clears only active blackjack hands and deal cooldown, not balances.
 * Shuffle: Fisher–Yates with crypto.randomInt (CSPRNG) so the deck is provably unpredictable.
 */

import { randomInt } from 'node:crypto';
import { kv } from '@/lib/kv';
import { getLeaderboardExclusions, setLeaderboardDisplayName } from '@/utils/leaderboard-storage';

const CREDITS_BALANCE_KEY = 'credits_balance';
const DEAL_COOLDOWN_KEY = 'blackjack_deal_last_at';
const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000;
const DEAL_COOLDOWN_MS = 15_000;
const MIN_BET = 25;

/** Minimum blackjack bet (for chat balance/limits messages). */
export const BLACKJACK_MIN_BET = MIN_BET;

function parseKvInt(value: number | string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  return typeof value === 'number' ? Math.floor(value) : parseInt(String(value), 10) || fallback;
}

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

/** Fisher–Yates shuffle using crypto.randomInt (CSPRNG). Each permutation of the deck is equally likely and unpredictable. */
function shuffleDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardDisplay(card: Card): string {
  return card;
}

function formatHand(cards: Card[]): string {
  return cards.map(cardDisplay).join(' ');
}

const NO_ACTIVE_HAND_MSG = '🃏 No active hand. Use !deal <amount> or !bj <amount> to play.';

function cardRank(card: Card): Rank {
  return card.slice(0, -1) as Rank;
}

function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cardRank(cards[0]) === cardRank(cards[1]);
}

function normalizeUser(username: string): string {
  return username.trim().toLowerCase();
}

function isBotUsername(normalizedUser: string): boolean {
  return normalizedUser.startsWith('@');
}

/** Check if credits/blackjack is enabled (from overlay settings). */
export async function isGamblingEnabled(): Promise<boolean> {
  try {
    const settings = (await kv.get<{ gamblingEnabled?: boolean }>('overlay_settings')) ?? {};
    return settings.gamblingEnabled !== false;
  } catch {
    return true;
  }
}

export async function isSettingEnabled(key: string): Promise<boolean> {
  try {
    const settings = (await kv.get<Record<string, unknown>>('overlay_settings')) ?? {};
    return settings[key] !== false;
  } catch {
    return true;
  }
}

export interface BlackjackGame {
  playerHand: Card[];
  playerHand2?: Card[];
  dealerHand: Card[];
  deck: Card[];
  bet: number;
  bet2?: number;
  status: 'playing' | 'stand' | 'bust' | 'blackjack' | 'dealer_turn';
  split?: boolean;
  hand1Done?: boolean;
  createdAt: number;
}

function gameKey(user: string): string {
  return `${ACTIVE_GAME_KEY_PREFIX}${user}`;
}

/** Get credits balance. New users have 0 (no auto-create). */
export async function getCredits(username: string): Promise<number> {
  const user = normalizeUser(username);
  try {
    const bal = await kv.hget<number | string>(CREDITS_BALANCE_KEY, user);
    if (bal != null) {
      return typeof bal === 'string' ? parseInt(bal, 10) : Math.floor(bal);
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Get credits only if the user already exists (no create). Use for !credits <other>. */
export async function getCreditsIfExists(username: string): Promise<number | null> {
  const user = normalizeUser(username);
  try {
    const bal = await kv.hget<number | string>(CREDITS_BALANCE_KEY, user);
    if (bal == null) return null;
    return typeof bal === 'string' ? parseInt(bal, 10) : Math.floor(bal);
  } catch {
    return null;
  }
}

/** Top N users by credits (for !leaderboard and overlay). Excludes leaderboard-excluded users. */
export async function getCreditsLeaderboard(topN: number): Promise<{ username: string; credits: number }[]> {
  const n = Math.max(1, Math.min(20, Math.floor(topN)));
  try {
    const raw = (await kv.hgetall(CREDITS_BALANCE_KEY)) as Record<string, string> | null;
    if (!raw || typeof raw !== 'object') return [];
    const excluded = await getLeaderboardExclusions();
    const entries: { username: string; credits: number }[] = [];
    for (const [user, val] of Object.entries(raw)) {
      if (excluded.has(user)) continue;
      const credits = parseKvInt(val);
      if (credits > 0) entries.push({ username: user, credits });
    }
    entries.sort((a, b) => b.credits - a.credits);
    return entries.slice(0, n);
  } catch {
    return [];
  }
}

async function deductCredits(user: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  const bal = await getCredits(user);
  if (bal < amount) return { ok: false, balance: bal };
  const newBal = bal - amount;
  await kv.hset(CREDITS_BALANCE_KEY, { [user]: String(newBal) });
  return { ok: true, balance: newBal };
}

/** Add credits to a user. Used for BJ wins, sub/gift/kicks, and !addcredits. Excludes bots and leaderboard-excluded users when called from events. */
export async function addCredits(username: string, amount: number, options?: { skipExclusions?: boolean }): Promise<number> {
  const user = normalizeUser(username);
  if (isBotUsername(user)) return 0;
  if (amount < 1) return 0;
  if (!options?.skipExclusions) {
    const excluded = await getLeaderboardExclusions();
    if (excluded.has(user)) return 0;
  }
  const bal = await getCredits(user);
  const newBal = bal + amount;
  await kv.hset(CREDITS_BALANCE_KEY, { [user]: String(newBal) });
  if (username?.trim()) await setLeaderboardDisplayName(user, username.trim());
  return newBal;
}

async function placeBet(user: string, requestedBet: number): Promise<{ ok: false; balance: number } | { ok: true; bet: number; balance: number }> {
  const bal = await getCredits(user);
  if (bal < MIN_BET) return { ok: false, balance: bal };
  const bet = Math.min(Math.floor(Math.max(MIN_BET, requestedBet)), bal);
  const newBal = bal - bet;
  await kv.hset(CREDITS_BALANCE_KEY, { [user]: String(newBal) });
  return { ok: true, bet, balance: newBal };
}

/** Clear only blackjack state on stream start (active hands + deal cooldown). Does not clear credits balances. */
export async function clearBlackjackStateOnStreamStart(): Promise<void> {
  try {
    await kv.del(DEAL_COOLDOWN_KEY);
    const gameKeys = await kv.keys(`${ACTIVE_GAME_KEY_PREFIX}*`);
    if (Array.isArray(gameKeys) && gameKeys.length > 0) {
      await kv.del(...gameKeys);
    }
    console.log('[Credits] Blackjack state cleared on stream start at', new Date().toISOString());
  } catch (e) {
    console.warn('[Credits] Failed to clear blackjack state on stream start:', e);
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

  const now = Date.now();
  const lastAt = parseKvInt(await kv.hget<number | string>(DEAL_COOLDOWN_KEY, user));
  if (lastAt > 0 && now - lastAt < DEAL_COOLDOWN_MS) {
    const wait = Math.ceil((DEAL_COOLDOWN_MS - (now - lastAt)) / 1000);
    return `🃏 Wait ${wait}s before starting another hand.`;
  }

  const existing = await getActiveGame(username);
  if (existing) {
    const { value } = handValue(existing.playerHand);
    return `🃏 You're already in a hand (${formatHand(existing.playerHand)} = ${value}). !hit or !stand`;
  }

  const balance = await getCredits(user);
  if (balance < MIN_BET) {
    return `🃏 You need at least ${MIN_BET} Credits to play. You have ${balance} Credits.`;
  }
  const requestedFloored = Number.isFinite(betAmount) ? Math.floor(betAmount) : balance;
  if (requestedFloored < MIN_BET) {
    return `🃏 Min bet is ${MIN_BET} Credits. You have ${balance} Credits. Use !bj <amount> (${MIN_BET}–${balance}).`;
  }
  if (requestedFloored > balance) {
    return `🃏 Not enough Credits for that bet. You have ${balance} Credits. Use !bj <amount> (${MIN_BET}–${balance}).`;
  }

  const result = await placeBet(user, requestedFloored);
  if (!result.ok) {
    return `🃏 Not enough Credits (${result.balance}). Min bet: ${MIN_BET}. Use !bj <amount> (${MIN_BET}–${result.balance}).`;
  }
  const { bet } = result;

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
      const bal = await addCredits(user, bet, { skipExclusions: true });
      await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
      return `🃏 Push! Both 21. +0 (${bal} Credits)`;
    }
    const win = Math.floor(bet * 1.5);
    const bal = await addCredits(user, bet + win, { skipExclusions: true });
    await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
    return `🃏 Blackjack! +${win}! (${bal} Credits)`;
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
  const extras = isPair(playerHand) ? ' | double | split' : ' | double';
  return `🃏 ${formatHand(playerHand)} (${playerVal.value}) vs ${dealerVis} | Bet: ${bet} — hit or stand${extras}`;
}

/** Double - double bet, take one card, stand. Only when 2 cards and not split. */
export async function double(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return NO_ACTIVE_HAND_MSG;
  if (game.split) return `🃏 Can't double on split hands. hit or stand.`;
  if (game.playerHand.length !== 2) return `🃏 double only on first 2 cards. hit or stand.`;

  const extraBet = game.bet;
  const { ok, balance } = await deductCredits(user, extraBet);
  if (!ok) {
    return `🃏 Not enough Credits to double (need ${extraBet}, have ${balance}).`;
  }

  const card = game.deck.pop()!;
  game.playerHand.push(card);
  const { value } = handValue(game.playerHand);

  if (value > 21) {
    await kv.del(gameKey(user));
    const bal = await getCredits(user);
    return `🃏 Double bust (${value})! -${game.bet * 2}. (${bal} Credits)`;
  }

  game.bet *= 2;
  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  const standResult = await stand(username);
  return `🃏 Doubled! Drew ${cardDisplay(card)} → ${value}. ${standResult.replace(/^🃏 /, '')}`;
}

/** Split - split pair into two hands. Requires pair and matching bet. */
export async function split(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return NO_ACTIVE_HAND_MSG;
  if (game.split) return `🃏 Already split. hit or stand.`;
  if (!isPair(game.playerHand)) return `🃏 split only on pairs. hit or stand.`;

  const extraBet = game.bet;
  const { ok, balance } = await deductCredits(user, extraBet);
  if (!ok) {
    return `🃏 Not enough Credits to split (need ${extraBet}, have ${balance}).`;
  }

  const [c1, c2] = game.playerHand;
  game.playerHand = [c1];
  game.playerHand2 = [c2];
  game.bet2 = extraBet;
  game.split = true;
  game.hand1Done = false;

  const card1 = game.deck.pop()!;
  const card2 = game.deck.pop()!;
  game.playerHand.push(card1);
  game.playerHand2!.push(card2);

  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  const v1 = handValue(game.playerHand).value;
  return `🃏 Split! H1: ${formatHand(game.playerHand)} (${v1}) — hit or stand (H2: ${formatHand(game.playerHand2!)} waits)`;
}

/** Hit - draw a card. */
export async function hit(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return NO_ACTIVE_HAND_MSG;

  const isHand1 = !game.split || !game.hand1Done;
  const hand = isHand1 ? game.playerHand : game.playerHand2!;

  const card = game.deck.pop()!;
  hand.push(card);
  const { value } = handValue(hand);

  if (value > 21) {
    if (game.split) {
      if (!game.hand1Done) {
        game.hand1Done = true;
        game.createdAt = Date.now();
        await kv.set(gameKey(user), game);
        const v2 = handValue(game.playerHand2!).value;
        if (v2 > 21) {
          await kv.del(gameKey(user));
          const bal = await getCredits(user);
          return `🃏 H1 bust! H2 (${v2}) bust too. -${game.bet + game.bet2!}. (${bal} Credits)`;
        }
        return `🃏 H1 bust! H2: ${formatHand(game.playerHand2!)} (${v2}) — hit or stand`;
      } else {
        await kv.del(gameKey(user));
        const bal = await getCredits(user);
        return `🃏 H2 bust (${value})! -${game.bet + game.bet2!}. (${bal} Credits)`;
      }
    }
    await kv.del(gameKey(user));
    const bal = await getCredits(user);
    return `🃏 Bust (${value})! -${game.bet}. (${bal} Credits)`;
  }

  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  const handLabel = game.split ? (isHand1 ? 'H1' : 'H2') : '';
  return `🃏 ${cardDisplay(card)} → ${handLabel ? handLabel + ': ' : ''}${formatHand(hand)} (${value}) — hit or stand`;
}

function resolveHand(
  dealerVal: number,
  playerVal: number,
  bet: number,
): { win: number; msg: string } {
  if (dealerVal > 21) return { win: bet * 2, msg: `Dealer busts! +${bet}` };
  if (dealerVal > playerVal) return { win: 0, msg: `Dealer ${dealerVal} vs ${playerVal}. -${bet}` };
  if (dealerVal < playerVal) return { win: bet * 2, msg: `${playerVal} vs ${dealerVal}. +${bet}` };
  return { win: bet, msg: `Push` };
}

/** Stand - dealer plays (or switch to hand 2 when split). */
export async function stand(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return NO_ACTIVE_HAND_MSG;

  if (game.split && !game.hand1Done) {
    game.hand1Done = true;
    game.createdAt = Date.now();
    await kv.set(gameKey(user), game);
    const v2 = handValue(game.playerHand2!).value;
    return `🃏 H1 stood. H2: ${formatHand(game.playerHand2!)} (${v2}) — hit or stand`;
  }

  const dealerHand = [...game.dealerHand];
  const deck = [...game.deck];

  while (handValue(dealerHand).value < 17) {
    const card = deck.pop()!;
    dealerHand.push(card);
  }

  const dealerVal = handValue(dealerHand).value;

  if (game.split && game.playerHand2) {
    const v1 = handValue(game.playerHand).value;
    const v2 = handValue(game.playerHand2).value;
    const r1 = v1 <= 21 ? resolveHand(dealerVal, v1, game.bet) : { win: 0, msg: `Bust. -${game.bet}` };
    const r2 = v2 <= 21 ? resolveHand(dealerVal, v2, game.bet2!) : { win: 0, msg: `Bust. -${game.bet2!}` };
    const totalWin = r1.win + r2.win;
    const totalBet = game.bet + game.bet2!;
    const bal = totalWin > 0 ? await addCredits(user, totalWin, { skipExclusions: true }) : await getCredits(user);
    await kv.del(gameKey(user));
    const net = totalWin - totalBet;
    return `🃏 Dealer ${dealerVal} | H1: ${r1.msg} | H2: ${r2.msg} | ${net >= 0 ? '+' : ''}${net} (${bal} Credits)`;
  }

  const playerVal = handValue(game.playerHand).value;
  const { win, msg } = resolveHand(dealerVal, playerVal, game.bet);
  const bal = win > 0 ? await addCredits(user, win, { skipExclusions: true }) : await getCredits(user);
  await kv.del(gameKey(user));
  return `🃏 Dealer ${dealerVal}. ${msg} (${bal} Credits)`;
}
