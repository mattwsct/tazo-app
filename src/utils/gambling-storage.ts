/**
 * Gambling tazos (separate from leaderboard points), per-user game state.
 * Commands: !deal <amount>, hit, stand, double (2 cards), split (pairs). Tazos and gambling leaderboard reset each stream.
 * New players start with 100 tazos.
 */

import { kv } from '@vercel/kv';
import { getLeaderboardExclusions, setLeaderboardDisplayName } from '@/utils/leaderboard-storage';

const VIEW_TAZOS_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const VIEW_TAZOS_PER_INTERVAL = 10;

const TAZOS_BALANCE_KEY = 'blackjack_chips'; // KV key unchanged for data compat
const GAMBLING_LEADERBOARD_KEY = 'blackjack_leaderboard';
const DEAL_COOLDOWN_KEY = 'blackjack_deal_last_at';
const VIEW_TAZOS_LAST_AT_KEY = 'blackjack_view_chips_last_at'; // KV key unchanged
const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000;
const DEAL_COOLDOWN_MS = 15_000;
const GAMBLE_INSTANT_COOLDOWN_MS = 5_000;
const GAMBLE_INSTANT_LAST_AT_KEY = 'gamble_instant_last_at';
const STARTING_TAZOS = 100;
const MIN_BET = 1;
const DUEL_KEY_PREFIX = 'gamble_duel:';
const DUEL_EXPIRE_SEC = 60;

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
  return card;
}

function formatHand(cards: Card[]): string {
  return cards.map(cardDisplay).join(' ');
}

const NO_ACTIVE_HAND_MSG = '🃏 No active hand. Use !deal <amount> to play.';

function cardRank(card: Card): Rank {
  return card.slice(0, -1) as Rank;
}

function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cardRank(cards[0]) === cardRank(cards[1]);
}

function normalizeUser(username: string): string {
  return username.trim().toLowerCase();
}

/** Check if gambling is enabled (from overlay settings). When false, all blackjack commands should be disabled. */
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

/** Get or create tazos balance. New players start with STARTING_TAZOS. */
export async function getTazos(username: string): Promise<number> {
  const user = normalizeUser(username);
  try {
    const bal = await kv.hget<number | string>(TAZOS_BALANCE_KEY, user);
    if (bal != null) {
      return typeof bal === 'string' ? parseInt(bal, 10) : Math.floor(bal);
    }
    const init: Promise<unknown>[] = [
      kv.hset(TAZOS_BALANCE_KEY, { [user]: String(STARTING_TAZOS) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: STARTING_TAZOS, member: user }),
    ];
    if (username?.trim()) init.push(setLeaderboardDisplayName(user, username.trim()));
    await Promise.all(init);
    return STARTING_TAZOS;
  } catch {
    return STARTING_TAZOS;
  }
}

async function deductTazos(user: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  const bal = await getTazos(user);
  if (bal < amount) return { ok: false, balance: bal };
  const newBal = bal - amount;
  await Promise.all([
    kv.hset(TAZOS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return { ok: true, balance: newBal };
}

async function placeBet(user: string, requestedBet: number): Promise<{ ok: false; balance: number } | { ok: true; bet: number; balance: number }> {
  const bal = await getTazos(user);
  if (bal < MIN_BET) return { ok: false, balance: bal };
  const bet = Math.min(Math.floor(Math.max(MIN_BET, requestedBet)), bal);
  const newBal = bal - bet;
  await Promise.all([
    kv.hset(TAZOS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return { ok: true, bet, balance: newBal };
}

async function addTazos(user: string, amount: number): Promise<number> {
  const bal = await getTazos(user);
  const newBal = bal + amount;
  await Promise.all([
    kv.hset(TAZOS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return newBal;
}

/** Add tazos as admin (broadcaster/mod via !addtazos). Bypasses gambling check and exclusions. */
export async function addTazosAsAdmin(username: string, amount: number): Promise<number> {
  const user = normalizeUser(username);
  if (amount < 1) return 0;
  await addTazos(user, amount);
  if (username?.trim()) await setLeaderboardDisplayName(user, username.trim());
  return amount;
}

/** Add tazos for channel point reward redemption. */
export async function addTazosForReward(username: string, amount: number): Promise<number> {
  const user = normalizeUser(username);
  if (!(await isGamblingEnabled())) return 0;
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return 0;
  if (amount < 1) return 0;
  await addTazos(user, amount);
  return amount;
}

/** Award tazos for watch time (chat as heartbeat). 10 tazos per 10 min, no cap. */
export async function addViewTimeTazos(username: string): Promise<number> {
  const user = normalizeUser(username);
  if (!(await isGamblingEnabled())) return 0;
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return 0;

  try {
    const now = Date.now();
    const lastAt = parseKvInt(await kv.hget<number | string>(VIEW_TAZOS_LAST_AT_KEY, user));
    const elapsed = lastAt > 0 ? now - lastAt : VIEW_TAZOS_INTERVAL_MS;
    const intervals = Math.floor(elapsed / VIEW_TAZOS_INTERVAL_MS);
    if (intervals < 1) return 0;

    const bal = await getTazos(user);

    const tazosToAdd = Math.min(intervals, 1) * VIEW_TAZOS_PER_INTERVAL;
    if (tazosToAdd <= 0) return 0;
    const newBal = bal + tazosToAdd;
    const updates: Promise<unknown>[] = [
      kv.hset(TAZOS_BALANCE_KEY, { [user]: String(newBal) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
      kv.hset(VIEW_TAZOS_LAST_AT_KEY, { [user]: String(now) }),
    ];
    if (username?.trim()) updates.push(setLeaderboardDisplayName(user, username.trim()));
    await Promise.all(updates);
    return tazosToAdd;
  } catch {
    return 0;
  }
}

/** Reset tazos and gambling leaderboard on stream start. */
export async function resetGamblingOnStreamStart(): Promise<void> {
  try {
    await Promise.all([
      kv.del(TAZOS_BALANCE_KEY),
      kv.del(GAMBLING_LEADERBOARD_KEY),
      kv.del(DEAL_COOLDOWN_KEY),
      kv.del(VIEW_TAZOS_LAST_AT_KEY),
    ]);
    console.log('[Gambling] Tazos and leaderboard reset on stream start at', new Date().toISOString());
  } catch (e) {
    console.warn('[Gambling] Failed to reset on stream start:', e);
  }
}

/** Get top N by tazos (gambling leaderboard). */
export async function getGamblingLeaderboardTop(n: number): Promise<{ username: string; chips: number }[]> {
  try {
    const excluded = await getLeaderboardExclusions();
    const names = (await kv.hgetall<Record<string, string>>(LEADERBOARD_DISPLAY_NAMES_KEY)) ?? {};
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
    return result;
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

  const result = await placeBet(user, betAmount);
  if (!result.ok) {
    return `🃏 Not enough tazos (${result.balance}).`;
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
      const bal = await addTazos(user, bet);
      await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
      return `🃏 Push! Both 21. +0 (${bal} tazos)`;
    }
    const win = Math.floor(bet * 1.5);
    const bal = await addTazos(user, bet + win);
    await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
    return `🃏 Blackjack! +${win}! (${bal} tazos)`;
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
  const { ok, balance } = await deductTazos(user, extraBet);
  if (!ok) {
    return `🃏 Not enough tazos to double (need ${extraBet}, have ${balance}).`;
  }

  const card = game.deck.pop()!;
  game.playerHand.push(card);
  const { value } = handValue(game.playerHand);

  if (value > 21) {
    await kv.del(gameKey(user));
    const bal = await getTazos(user);
    return `🃏 Double bust (${value})! -${game.bet * 2}. (${bal} tazos)`;
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
  const { ok, balance } = await deductTazos(user, extraBet);
  if (!ok) {
    return `🃏 Not enough tazos to split (need ${extraBet}, have ${balance}).`;
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
          const bal = await getTazos(user);
          return `🃏 H1 bust! H2 (${v2}) bust too. -${game.bet + game.bet2!}. (${bal} tazos)`;
        }
        return `🃏 H1 bust! H2: ${formatHand(game.playerHand2!)} (${v2}) — hit or stand`;
      } else {
        await kv.del(gameKey(user));
        const bal = await getTazos(user);
        return `🃏 H2 bust (${value})! -${game.bet + game.bet2!}. (${bal} tazos)`;
      }
    }
    await kv.del(gameKey(user));
    const bal = await getTazos(user);
    return `🃏 Bust (${value})! -${game.bet}. (${bal} tazos)`;
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
    const bal = totalWin > 0 ? await addTazos(user, totalWin) : await getTazos(user);
    await kv.del(gameKey(user));
    const net = totalWin - totalBet;
    return `🃏 Dealer ${dealerVal} | H1: ${r1.msg} | H2: ${r2.msg} | ${net >= 0 ? '+' : ''}${net} (${bal} tazos)`;
  }

  const playerVal = handValue(game.playerHand).value;
  const { win, msg } = resolveHand(dealerVal, playerVal, game.bet);
  const bal = win > 0 ? await addTazos(user, win) : await getTazos(user);
  await kv.del(gameKey(user));
  return `🃏 Dealer ${dealerVal}. ${msg} (${bal} tazos)`;
}

// --- Instant games: coinflip, slots, roulette, dice ---

async function checkInstantCooldown(user: string): Promise<number | null> {
  const now = Date.now();
  const lastAt = parseKvInt(await kv.hget<number | string>(GAMBLE_INSTANT_LAST_AT_KEY, user));
  if (lastAt > 0 && now - lastAt < GAMBLE_INSTANT_COOLDOWN_MS) {
    return Math.ceil((GAMBLE_INSTANT_COOLDOWN_MS - (now - lastAt)) / 1000);
  }
  return null;
}

async function setInstantCooldown(user: string): Promise<void> {
  await kv.hset(GAMBLE_INSTANT_LAST_AT_KEY, { [user]: String(Date.now()) });
}

/** Gamble: straight 50/50, 2x on win. */
export async function playCoinflip(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎲 Wait ${wait}s before another game.`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🎲 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  if (Math.random() < 0.5) {
    const bal = await addTazos(user, bet * 2);
    const streak = await recordWin(user);
    return `🎲 +${bet}! (${bal} tazos)${streak}`;
  }
  await recordLoss(user);
  return `🎲 -${bet}. (${result.balance} tazos)`;
}

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍀', '7️⃣', '💎'] as const;
const SLOT_MULTIPLIERS: Record<(typeof SLOT_SYMBOLS)[number], number> = {
  '🍒': 2,
  '🍋': 3,
  '🍊': 5,
  '🍀': 8,
  '7️⃣': 12,
  '💎': 25,
};

/** Slots: 3 reels, match 3 = big win, match 2 = push. */
export async function playSlots(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎰 Wait ${wait}s before another spin.`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🎰 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const reels = [
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
  ] as (typeof SLOT_SYMBOLS)[number][];
  const display = reels.join(' ');

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const mult = SLOT_MULTIPLIERS[reels[0]];
    const win = bet * mult;
    const bal = await addTazos(user, win);
    const streak = await recordWin(user);
    return `🎰 [${display}] JACKPOT ${mult}x! +${win - bet} (${bal} tazos)${streak}`;
  }
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    const match = reels[0] === reels[1] ? reels[0] : reels[1];
    const mult = Math.max(1, Math.floor(SLOT_MULTIPLIERS[match] / 2));
    const win = bet * mult;
    const bal = await addTazos(user, win);
    const net = win - bet;
    if (net > 0) {
      const streak = await recordWin(user);
      return `🎰 [${display}] 2-match ${mult}x! +${net} (${bal} tazos)${streak}`;
    }
    return `🎰 [${display}] 2-match — push. (${bal} tazos)`;
  }
  await recordLoss(user);
  return `🎰 [${display}] No match. -${bet} (${result.balance} tazos)`;
}

const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Roulette: bet red/black (2x) or number 1-36 (36x). */
export async function playRoulette(username: string, choice: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎡 Wait ${wait}s before another spin.`;

  const choiceLower = choice.trim().toLowerCase();
  const isRed = choiceLower === 'red';
  const isBlack = choiceLower === 'black';
  const numBet = !isRed && !isBlack ? parseInt(choice, 10) : NaN;
  const isValidNum = !isNaN(numBet) && numBet >= 1 && numBet <= 36;

  if (!isRed && !isBlack && !isValidNum) {
    return `🎡 Bet red, black, or a number 1-36. !roulette red 10`;
  }

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🎡 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const spin = Math.floor(Math.random() * 37);
  const spinRed = ROULETTE_RED.has(spin);
  const spinBlack = spin >= 1 && spin <= 36 && !spinRed;
  const spinStr = spin === 0 ? '0 (green)' : `${spin} (${spinRed ? 'red' : spinBlack ? 'black' : 'green'})`;

  if (isRed) {
    if (spinRed) {
      const bal = await addTazos(user, bet * 2);
      const streak = await recordWin(user);
      return `🎡 [${spinStr}] Red! +${bet} (${bal} tazos)${streak}`;
    }
    await recordLoss(user);
    return `🎡 [${spinStr}] Red lost. -${bet} (${result.balance} tazos)`;
  }
  if (isBlack) {
    if (spinBlack) {
      const bal = await addTazos(user, bet * 2);
      const streak = await recordWin(user);
      return `🎡 [${spinStr}] Black! +${bet} (${bal} tazos)${streak}`;
    }
    await recordLoss(user);
    return `🎡 [${spinStr}] Black lost. -${bet} (${result.balance} tazos)`;
  }
  if (spin === numBet) {
    const win = bet * 36;
    const bal = await addTazos(user, win);
    const streak = await recordWin(user);
    return `🎡 [${spinStr}] NUMBER HIT 36x! +${win - bet} (${bal} tazos)${streak}`;
  }
  await recordLoss(user);
  return `🎡 [${spinStr}] Miss. -${bet} (${result.balance} tazos)`;
}

/** Dice: bet high (4-6) or low (1-3). 2x on win. */
export async function playDice(username: string, choice: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎲 Wait ${wait}s before another roll.`;

  const choiceLower = choice.trim().toLowerCase();
  const isHigh = choiceLower === 'high' || choiceLower === 'h';
  const isLow = choiceLower === 'low' || choiceLower === 'l';
  if (!isHigh && !isLow) return `🎲 Bet high (4-6) or low (1-3). !dice high 10`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🎲 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const roll = Math.floor(Math.random() * 6) + 1;
  const won = (isHigh && roll >= 4) || (isLow && roll <= 3);
  if (won) {
    const bal = await addTazos(user, bet * 2);
    const streak = await recordWin(user);
    return `🎲 Rolled ${roll} (${isHigh ? 'high' : 'low'}) +${bet}! (${bal} tazos)${streak}`;
  }
  await recordLoss(user);
  return `🎲 Rolled ${roll} (${roll >= 4 ? 'high' : 'low'}) -${bet}. (${result.balance} tazos)`;
}

// --- Crash ---

/** Crash: pick a cashout target (default 2x). Crash point is random; if >= target you win target * bet. */
export async function playCrash(username: string, betAmount: number, targetMultiplier?: number): Promise<string> {
  const user = normalizeUser(username);
  const target = Math.max(1.1, targetMultiplier ?? 2);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `💥 Wait ${wait}s before another game.`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `💥 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const r = Math.random();
  const crashPoint = Math.max(1, Math.floor(100 / (1 - r * 0.97)) / 100);

  const crashStr = crashPoint.toFixed(2) + 'x';
  const targetStr = target.toFixed(2) + 'x';

  if (crashPoint >= target) {
    const win = Math.floor(bet * target);
    const bal = await addTazos(user, win);
    const streak = await recordWin(user);
    return `💥 Crashed ${crashStr}, cashed ${targetStr}! +${win - bet} (${bal} tazos)${streak}`;
  }
  await recordLoss(user);
  return `💥 Crashed ${crashStr}, target ${targetStr}. -${bet} (${result.balance} tazos)`;
}

// --- War ---

const WAR_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

function warCardValue(rank: string): number {
  return WAR_RANKS.indexOf(rank as (typeof WAR_RANKS)[number]);
}

/** War: both draw a card, higher wins. Tie = push. */
export async function playWar(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `⚔️ Wait ${wait}s before another game.`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `⚔️ Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const playerRankIdx = Math.floor(Math.random() * WAR_RANKS.length);
  const dealerRankIdx = Math.floor(Math.random() * WAR_RANKS.length);
  const playerCard = WAR_RANKS[playerRankIdx];
  const dealerCard = WAR_RANKS[dealerRankIdx];
  const pVal = warCardValue(playerCard);
  const dVal = warCardValue(dealerCard);

  const suitP = SUITS[Math.floor(Math.random() * SUITS.length)];
  const suitD = SUITS[Math.floor(Math.random() * SUITS.length)];

  if (pVal > dVal) {
    const bal = await addTazos(user, bet * 2);
    const streak = await recordWin(user);
    return `⚔️ ${playerCard}${suitP} vs ${dealerCard}${suitD} +${bet}! (${bal} tazos)${streak}`;
  }
  if (pVal < dVal) {
    await recordLoss(user);
    return `⚔️ ${playerCard}${suitP} vs ${dealerCard}${suitD} -${bet}. (${result.balance} tazos)`;
  }
  const bal = await addTazos(user, bet);
  return `⚔️ ${playerCard}${suitP} vs ${dealerCard}${suitD} Tie! (${bal} tazos)`;
}

// --- Duel ---

interface PendingDuel {
  challenger: string;
  challengerDisplay: string;
  bet: number;
  createdAt: number;
}

function duelKey(target: string): string {
  return `${DUEL_KEY_PREFIX}${target}`;
}

/** Challenge another user. Stores a pending duel that expires after 60s. */
export async function challengeDuel(challengerUsername: string, targetUsername: string, betAmount: number): Promise<string> {
  const challenger = normalizeUser(challengerUsername);
  const target = normalizeUser(targetUsername);

  if (challenger === target) return `⚔️ You can't duel yourself.`;

  const wait = await checkInstantCooldown(challenger);
  if (wait !== null) return `⚔️ Wait ${wait}s before another game.`;

  const result = await placeBet(challenger, betAmount);
  if (!result.ok) return `⚔️ Not enough tazos (${result.balance}).`;
  const { bet } = result;

  const duel: PendingDuel = {
    challenger,
    challengerDisplay: challengerUsername.trim(),
    bet,
    createdAt: Date.now(),
  };
  await kv.set(duelKey(target), duel, { ex: DUEL_EXPIRE_SEC });
  await setInstantCooldown(challenger);

  return `⚔️ ${challengerUsername.trim()} challenges ${targetUsername.trim()} for ${bet} tazos! accept (60s)`;
}

/** Accept a pending duel. Both players' tazos are at stake, 50/50 winner takes all. */
export async function acceptDuel(accepterUsername: string): Promise<string> {
  const accepter = normalizeUser(accepterUsername);
  const raw = await kv.get<PendingDuel>(duelKey(accepter));
  if (!raw) return `⚔️ No pending duel. Someone can challenge you with !duel @${accepterUsername.trim()} <amount>`;

  const duel = raw as PendingDuel;
  if (Date.now() - duel.createdAt > DUEL_EXPIRE_SEC * 1000) {
    await kv.del(duelKey(accepter));
    await addTazos(duel.challenger, duel.bet);
    return `⚔️ Duel expired. ${duel.challengerDisplay}'s ${duel.bet} tazos refunded.`;
  }

  const { ok, balance } = await deductTazos(accepter, duel.bet);
  if (!ok) {
    await kv.del(duelKey(accepter));
    await addTazos(duel.challenger, duel.bet);
    return `⚔️ Not enough tazos (need ${duel.bet}, have ${balance}). Duel cancelled.`;
  }

  await kv.del(duelKey(accepter));

  const totalPot = duel.bet * 2;
  const challengerWins = Math.random() < 0.5;
  const winner = challengerWins ? duel.challenger : accepter;
  const winnerDisplay = challengerWins ? duel.challengerDisplay : accepterUsername.trim();
  const loserDisplay = challengerWins ? accepterUsername.trim() : duel.challengerDisplay;

  const bal = await addTazos(winner, totalPot);

  return `⚔️ ${winnerDisplay} beats ${loserDisplay}! +${totalPot} (${bal} tazos)`;
}

// --- Heist ---

const HEIST_KEY = 'heist_active';
const HEIST_JOIN_WINDOW_MS = 60_000;
const HEIST_TTL_SEC = 180;
const HEIST_MAX_PARTICIPANTS = 10;

interface HeistState {
  participants: Array<{ user: string; display: string; bet: number }>;
  startedAt: number;
}

function heistSuccessRate(numPlayers: number): number {
  return Math.min(75, 20 + numPlayers * 10);
}

async function resolveHeist(heist: HeistState): Promise<string> {
  await kv.del(HEIST_KEY);

  const numPlayers = heist.participants.length;
  const successRate = heistSuccessRate(numPlayers);
  const succeeded = Math.random() * 100 < successRate;
  const totalPot = heist.participants.reduce((sum, p) => sum + p.bet, 0);

  if (succeeded) {
    const multiplier = 1.5 + Math.random();
    const payouts: string[] = [];
    for (const p of heist.participants) {
      const payout = Math.floor(p.bet * multiplier);
      const bal = await addTazos(p.user, payout);
      payouts.push(`${p.display} +${payout - p.bet} (${bal})`);
    }
    return `🏦💰 HEIST SUCCEEDED! ${numPlayers} robber${numPlayers > 1 ? 's' : ''} split the loot! ${payouts.join(', ')}`;
  }

  return `🏦🚔 HEIST FAILED! ${numPlayers === 1 ? 'Lone robber caught' : `All ${numPlayers} robbers caught`}! ${totalPot} tazos lost.`;
}

/** Auto-resolve expired heists (called by cron). Returns result message or null. */
export async function checkAndResolveExpiredHeist(): Promise<string | null> {
  const existing = await kv.get<HeistState>(HEIST_KEY);
  if (!existing) return null;
  if (Date.now() - existing.startedAt < HEIST_JOIN_WINDOW_MS) return null;
  return resolveHeist(existing);
}

/** Join or start a heist. Handles auto-resolution of expired heists. */
export async function joinOrStartHeist(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const display = username.trim();

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🏦 Wait ${wait}s before joining.`;

  const existing = await kv.get<HeistState>(HEIST_KEY);

  if (existing && Date.now() - existing.startedAt >= HEIST_JOIN_WINDOW_MS) {
    const heistResult = await resolveHeist(existing);
    return `${heistResult} Use !heist [amount] to start a new one.`;
  }

  if (existing) {
    if (existing.participants.some(p => p.user === user)) {
      return `🏦 You're already in this heist!`;
    }
    if (existing.participants.length >= HEIST_MAX_PARTICIPANTS) {
      return `🏦 Heist crew is full (max ${HEIST_MAX_PARTICIPANTS}).`;
    }

    const result = await placeBet(user, betAmount);
    if (!result.ok) return `🏦 Not enough tazos (${result.balance}).`;
    const { bet } = result;
    await setInstantCooldown(user);

    existing.participants.push({ user, display, bet });
    await kv.set(HEIST_KEY, existing, { ex: HEIST_TTL_SEC });

    const totalPot = existing.participants.reduce((sum, p) => sum + p.bet, 0);
    const rate = heistSuccessRate(existing.participants.length);
    const timeLeft = Math.ceil((HEIST_JOIN_WINDOW_MS - (Date.now() - existing.startedAt)) / 1000);

    return `🏦 ${display} joins! ${bet} tazos (${existing.participants.length} robbers, ${totalPot} pot, ${rate}%, ${timeLeft}s)`;
  }

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🏦 Not enough tazos (${result.balance}).`;
  const { bet } = result;
  await setInstantCooldown(user);

  const newHeist: HeistState = {
    participants: [{ user, display, bet }],
    startedAt: Date.now(),
  };
  await kv.set(HEIST_KEY, newHeist, { ex: HEIST_TTL_SEC });

  return `🏦 HEIST STARTED! ${display} bets ${bet} tazos. !heist [amount] to join! (60s)`;
}

/** Check heist status (called when !heist is used without an amount during an active heist). */
export async function getHeistStatus(): Promise<string | null> {
  const existing = await kv.get<HeistState>(HEIST_KEY);
  if (!existing) return null;
  if (Date.now() - existing.startedAt >= HEIST_JOIN_WINDOW_MS) return null;
  const totalPot = existing.participants.reduce((sum, p) => sum + p.bet, 0);
  const rate = heistSuccessRate(existing.participants.length);
  const timeLeft = Math.ceil((HEIST_JOIN_WINDOW_MS - (Date.now() - existing.startedAt)) / 1000);
  const names = existing.participants.map(p => p.display).join(', ');
  return `🏦 Active heist: ${names} (${existing.participants.length} robbers, ${totalPot} at stake, ${rate}% odds, ${timeLeft}s left). !heist [amount] to join!`;
}

// --- Raffle ---

const RAFFLE_KEY = 'raffle_active';
const RAFFLE_LAST_AT_KEY = 'raffle_last_at';
const RAFFLE_TTL_SEC = 600; // 10 min TTL safety net
const RAFFLE_ENTRY_WINDOW_MS = 60 * 1000; // 1 minute
const RAFFLE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes between raffles
const RAFFLE_RECENT_KEY = 'raffle_recent_keywords';
const RAFFLE_RECENT_MAX = 30;

const RAFFLE_KEYWORDS = [
  // Internet slang
  'rizz', 'sigma', 'based', 'slay', 'goat', 'sus', 'cap', 'bet', 'gyat',
  'yeet', 'vibe', 'bruh', 'fire', 'dub', 'cope', 'mald', 'valid', 'mid',
  'lit', 'aura', 'cooked', 'ratio', 'pog', 'kek', 'npc', 'banger', 'glaze',
  'seethe', 'bussin', 'skibidi', 'demure', 'fanum', 'ong', 'sheesh', 'bonk',
  'stonks', 'yoink', 'noice', 'chad', 'simp', 'drip', 'flex', 'savage',
  'beast', 'legend', 'vibes', 'toxic', 'squad', 'hype', 'goated', 'zamn',
  'pluh', 'dawg', 'chill', 'facts', 'juicy', 'crispy', 'finesse', 'spicy',
  'tazo',
  // Streamer names (from boss roster)
  'ice', 'sam', 'ebz', 'mando', 'abz', 'sjc', 'andy', 'moxie', 'eddie',
  'moises', 'shoovy', 'deepak', 'carldo', 'fousey', 'n3on', 'alexis',
  'jandro', 'hito', 'kimmee', 'nanatty', 'shotime',
];

function pickRafflePrize(): number {
  const roll = Math.random();
  if (roll < 0.6) return 25 + Math.floor(Math.random() * 26);       // 60%: 25-50
  if (roll < 0.9) return 50 + Math.floor(Math.random() * 51);       // 30%: 50-100
  return 100 + Math.floor(Math.random() * 51);                      // 10%: 100-150
}

async function pickRaffleKeyword(): Promise<string> {
  const recent = (await kv.get<string[]>(RAFFLE_RECENT_KEY)) ?? [];
  const available = RAFFLE_KEYWORDS.filter(k => !recent.includes(k));
  const pool = available.length > 0 ? available : RAFFLE_KEYWORDS;
  const keyword = pool[Math.floor(Math.random() * pool.length)];
  const updated = [...recent, keyword].slice(-RAFFLE_RECENT_MAX);
  await kv.set(RAFFLE_RECENT_KEY, updated);
  return keyword;
}

interface RaffleState {
  participants: Array<{ user: string; display: string }>;
  startedAt: number;
  prize: number;
  keyword: string;
}

/** Start a new raffle. Returns announcement message. */
export async function startRaffle(prize?: number): Promise<string> {
  const existing = await kv.get<RaffleState>(RAFFLE_KEY);
  if (existing && Date.now() - existing.startedAt < RAFFLE_ENTRY_WINDOW_MS) {
    const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - (Date.now() - existing.startedAt)) / 1000);
    return `🎰 Raffle already active! Type '${existing.keyword}' to enter (${timeLeft}s left).`;
  }
  const keyword = await pickRaffleKeyword();
  if (prize === undefined) prize = pickRafflePrize();
  const raffle: RaffleState = {
    participants: [],
    startedAt: Date.now(),
    prize,
    keyword,
  };
  await kv.set(RAFFLE_KEY, raffle, { ex: RAFFLE_TTL_SEC });
  return `🎰 RAFFLE! Type '${keyword}' in chat to enter! Drawing in 1 minute — winner gets ${prize} tazos! Spam it for more entries!`;
}

/** Try to enter a raffle via keyword match. Silent — always returns null (no chat reply). Each match = one more entry (spam for more chances). */
export async function tryRaffleKeywordEntry(username: string, content: string): Promise<string | null> {
  const word = content.trim().toLowerCase();
  if (!word || word.length > 20) return null;

  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  if (Date.now() - raffle.startedAt >= RAFFLE_ENTRY_WINDOW_MS) return null;
  if (word !== raffle.keyword) return null;

  const user = normalizeUser(username);
  const display = username.trim();
  raffle.participants.push({ user, display });
  await kv.set(RAFFLE_KEY, raffle, { ex: RAFFLE_TTL_SEC });
  return null;
}

/** Resolve the active raffle. Picks winner weighted by number of entries. */
export async function resolveRaffle(): Promise<string | null> {
  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  if (Date.now() - raffle.startedAt < RAFFLE_ENTRY_WINDOW_MS) return null;

  await kv.del(RAFFLE_KEY);
  await kv.set(RAFFLE_LAST_AT_KEY, String(Date.now()));

  if (raffle.participants.length === 0) return '🎰 Raffle ended — no entries this time.';

  const winner = raffle.participants[Math.floor(Math.random() * raffle.participants.length)];
  const bal = await addTazos(winner.user, raffle.prize);
  if (winner.display) await setLeaderboardDisplayName(winner.user, winner.display);

  const unique = new Set(raffle.participants.map(p => p.user)).size;
  return `🎰 RAFFLE WINNER! ${winner.display} wins ${raffle.prize} tazos! (${bal} total) — ${unique} entered`;
}

/** Check if enough time has passed to start a new raffle. */
export async function shouldStartRaffle(): Promise<boolean> {
  const existing = await kv.get<RaffleState>(RAFFLE_KEY);
  if (existing) return false;
  const lastAt = await kv.get<string>(RAFFLE_LAST_AT_KEY);
  const elapsed = lastAt ? Date.now() - parseInt(lastAt, 10) : RAFFLE_INTERVAL_MS;
  return elapsed >= RAFFLE_INTERVAL_MS;
}

/** Get raffle status for chat. */
export async function getRaffleStatus(): Promise<string | null> {
  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  if (Date.now() - raffle.startedAt >= RAFFLE_ENTRY_WINDOW_MS) return null;
  const unique = new Set(raffle.participants.map(p => p.user)).size;
  const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - (Date.now() - raffle.startedAt)) / 1000);
  return `🎰 Active raffle: ${unique} entered (${raffle.participants.length} entries), ${raffle.prize} tazo prize, ${timeLeft}s left. Type '${raffle.keyword}' to enter!`;
}

/** Get a mid-raffle reminder. Only fires once (between 40-80% of entry window). */
export async function getRaffleReminder(): Promise<string | null> {
  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  const elapsed = Date.now() - raffle.startedAt;
  if (elapsed < RAFFLE_ENTRY_WINDOW_MS * 0.4 || elapsed >= RAFFLE_ENTRY_WINDOW_MS * 0.8) return null;
  const unique = new Set(raffle.participants.map(p => p.user)).size;
  const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - elapsed) / 1000);
  return `🎰 Raffle ending soon! ${unique} entered — type '${raffle.keyword}' for more entries! (${timeLeft}s left, ${raffle.prize} tazos)`;
}

// --- Chat Activity / Top Chatter ---

const CHAT_ACTIVITY_KEY_PREFIX = 'chat_activity:';
const CHAT_ACTIVITY_META_PREFIX = 'chat_activity_meta:';
const CHAT_ACTIVITY_HASH_PREFIX = 'chat_activity_hash:';
const CHAT_ACTIVITY_LAST_RESOLVED_KEY = 'chat_activity_last_resolved';
const CHAT_ACTIVITY_TTL_SEC = 7200; // 2 hours
const CHAT_ACTIVITY_RATE_LIMIT_MS = 30_000; // 30s between counted messages
const TOP_CHATTER_PRIZE = 25;
const TOP_CHATTER_MIN_CHATTERS = 3;

function hourKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

/** Track a chat message for top-chatter scoring. Returns silently; anti-spam filters applied. */
export async function trackChatActivity(username: string, messageContent: string): Promise<void> {
  const user = normalizeUser(username);
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return;

  const hk = hourKey();
  const activityKey = `${CHAT_ACTIVITY_KEY_PREFIX}${hk}`;
  const metaKey = `${CHAT_ACTIVITY_META_PREFIX}${hk}`;
  const hashKey = `${CHAT_ACTIVITY_HASH_PREFIX}${hk}`;

  try {
    const now = Date.now();

    // Rate limit: max 1 counted message per 30s
    const lastAt = await kv.hget<string>(metaKey, user);
    if (lastAt && now - parseInt(lastAt, 10) < CHAT_ACTIVITY_RATE_LIMIT_MS) return;

    // Dedup: skip identical consecutive messages
    const msgHash = simpleHash(messageContent.trim().toLowerCase());
    const lastHash = await kv.hget<string>(hashKey, user);
    if (lastHash === msgHash) return;

    // All checks passed — count this message
    await Promise.all([
      kv.hincrby(activityKey, user, 1),
      kv.hset(metaKey, { [user]: String(now) }),
      kv.hset(hashKey, { [user]: msgHash }),
    ]);

    // Set TTL on first write (ignore errors if already set)
    await Promise.all([
      kv.expire(activityKey, CHAT_ACTIVITY_TTL_SEC),
      kv.expire(metaKey, CHAT_ACTIVITY_TTL_SEC),
      kv.expire(hashKey, CHAT_ACTIVITY_TTL_SEC),
    ]);
  } catch {
    // Silently ignore tracking errors
  }
}

/** Resolve top chatter for the previous hour. Returns announcement or null. */
export async function resolveTopChatter(): Promise<string | null> {
  const now = new Date();
  const currentHk = hourKey(now);
  const lastResolved = await kv.get<string>(CHAT_ACTIVITY_LAST_RESOLVED_KEY);
  if (lastResolved === currentHk) return null;

  // Resolve the previous hour
  const prevHour = new Date(now.getTime() - 60 * 60 * 1000);
  const prevHk = hourKey(prevHour);

  // Don't re-resolve the same hour
  if (lastResolved === prevHk) {
    await kv.set(CHAT_ACTIVITY_LAST_RESOLVED_KEY, currentHk);
    return null;
  }

  await kv.set(CHAT_ACTIVITY_LAST_RESOLVED_KEY, currentHk);

  const activityKey = `${CHAT_ACTIVITY_KEY_PREFIX}${prevHk}`;
  const counts = await kv.hgetall<Record<string, string | number>>(activityKey);
  if (!counts) return null;

  const entries = Object.entries(counts).map(([u, c]) => ({
    user: u,
    count: typeof c === 'number' ? c : parseInt(String(c), 10) || 0,
  }));

  if (entries.length < TOP_CHATTER_MIN_CHATTERS) return null;

  entries.sort((a, b) => b.count - a.count);
  const winner = entries[0];
  if (winner.count < 1) return null;

  const excluded = await getLeaderboardExclusions();
  if (excluded.has(winner.user)) return null;

  const bal = await addTazos(winner.user, TOP_CHATTER_PRIZE);
  const names = (await kv.hgetall<Record<string, string>>(LEADERBOARD_DISPLAY_NAMES_KEY)) ?? {};
  const displayName = names[winner.user] ?? winner.user;

  return `💬 Top chatter this hour: ${displayName} (${winner.count} messages) — +${TOP_CHATTER_PRIZE} tazos! (${bal} tazos)`;
}

// --- Tazo Drops ---

const TAZO_DROP_KEY = 'chip_drop_active'; // KV key unchanged
const TAZO_DROP_LAST_AT_KEY = 'chip_drop_last_at'; // KV key unchanged
const TAZO_DROP_TTL_SEC = 180;
const TAZO_DROP_WINDOW_MS = 2 * 60 * 1000;
const TAZO_DROP_INTERVAL_MS = 10 * 60 * 1000;
const TAZO_DROP_PRIZE = 5;
const TAZO_DROP_MAX_WINNERS = 5;

interface TazoDropState {
  keyword: string;
  prize: number;
  maxWinners: number;
  winners: Array<{ user: string; display: string }>;
  startedAt: number;
}

export async function startTazoDrop(prize = TAZO_DROP_PRIZE, maxWinners = TAZO_DROP_MAX_WINNERS): Promise<string> {
  const keyword = await pickRaffleKeyword();
  const drop: TazoDropState = { keyword, prize, maxWinners, winners: [], startedAt: Date.now() };
  await kv.set(TAZO_DROP_KEY, drop, { ex: TAZO_DROP_TTL_SEC });
  return `💧 Tazo drop! First ${maxWinners} to type '${keyword}' get ${prize} tazos!`;
}

export async function tryTazoDropEntry(username: string, content: string): Promise<string | null> {
  const word = content.trim().toLowerCase();
  if (!word || word.length > 20) return null;
  const drop = await kv.get<TazoDropState>(TAZO_DROP_KEY);
  if (!drop) return null;
  if (Date.now() - drop.startedAt >= TAZO_DROP_WINDOW_MS) return null;
  if (word !== drop.keyword) return null;
  const user = normalizeUser(username);
  if (drop.winners.some(w => w.user === user)) return null;
  const display = username.trim();
  drop.winners.push({ user, display });
  const bal = await addTazos(user, drop.prize);
  if (display) await setLeaderboardDisplayName(user, display);
  const full = drop.winners.length >= drop.maxWinners;
  if (full) {
    await kv.del(TAZO_DROP_KEY);
    await kv.set(TAZO_DROP_LAST_AT_KEY, String(Date.now()));
    return `💧 ${display} grabbed ${drop.prize} tazos! (${bal} tazos) — Drop complete!`;
  }
  await kv.set(TAZO_DROP_KEY, drop, { ex: TAZO_DROP_TTL_SEC });
  return `💧 ${display} grabbed ${drop.prize} tazos! (${bal} tazos) — ${drop.maxWinners - drop.winners.length} left!`;
}

export async function shouldStartTazoDrop(): Promise<boolean> {
  const existing = await kv.get<TazoDropState>(TAZO_DROP_KEY);
  if (existing) return false;
  const lastAt = await kv.get<string>(TAZO_DROP_LAST_AT_KEY);
  if (!lastAt) return true; // No prior drop — eligible immediately
  const lastMs = parseInt(lastAt, 10);
  if (Number.isNaN(lastMs) || lastMs > Date.now()) return true; // Invalid or future — treat as eligible
  return Date.now() - lastMs >= TAZO_DROP_INTERVAL_MS;
}

export async function resolveExpiredTazoDrop(): Promise<string | null> {
  const drop = await kv.get<TazoDropState>(TAZO_DROP_KEY);
  if (!drop) return null;
  if (Date.now() - drop.startedAt < TAZO_DROP_WINDOW_MS) return null;
  await kv.del(TAZO_DROP_KEY);
  await kv.set(TAZO_DROP_LAST_AT_KEY, String(Date.now()));
  if (drop.winners.length === 0) return null;
  const names = drop.winners.map(w => w.display).join(', ');
  return `💧 Drop ended! ${drop.winners.length} grabbed tazos: ${names}`;
}

// --- Chat Challenges ---

const CHAT_CHALLENGE_KEY = 'chat_challenge_active';
const CHAT_CHALLENGE_LAST_AT_KEY = 'chat_challenge_last_at';
const CHAT_CHALLENGE_TTL_SEC = 180;
const CHAT_CHALLENGE_WINDOW_MS = 2 * 60 * 1000;
const CHAT_CHALLENGE_INTERVAL_MS = 15 * 60 * 1000;
const CHAT_CHALLENGE_TARGET = 50;
const CHAT_CHALLENGE_PRIZE = 5;
const CHAT_CHALLENGE_MAX_PER_USER = 3;

interface ChatChallengeState {
  target: number;
  prize: number;
  startedAt: number;
  participants: Record<string, number>;
  messageCount: number;
}

export async function startChatChallenge(target = CHAT_CHALLENGE_TARGET, prize = CHAT_CHALLENGE_PRIZE): Promise<string> {
  const challenge: ChatChallengeState = { target, prize, startedAt: Date.now(), participants: {}, messageCount: 0 };
  await kv.set(CHAT_CHALLENGE_KEY, challenge, { ex: CHAT_CHALLENGE_TTL_SEC });
  return `🎯 CHAT CHALLENGE! Send ${target} messages in 2 minutes and everyone gets ${prize} tazos! Go go go!`;
}

export async function trackChallengeMessage(username: string): Promise<void> {
  try {
    const challenge = await kv.get<ChatChallengeState>(CHAT_CHALLENGE_KEY);
    if (!challenge) return;
    if (Date.now() - challenge.startedAt >= CHAT_CHALLENGE_WINDOW_MS) return;
    const user = normalizeUser(username);
    const userCount = challenge.participants[user] ?? 0;
    if (userCount >= CHAT_CHALLENGE_MAX_PER_USER) return;
    challenge.participants[user] = userCount + 1;
    challenge.messageCount++;
    await kv.set(CHAT_CHALLENGE_KEY, challenge, { ex: CHAT_CHALLENGE_TTL_SEC });
  } catch { /* silent */ }
}

export async function resolveChatChallenge(): Promise<string | null> {
  const challenge = await kv.get<ChatChallengeState>(CHAT_CHALLENGE_KEY);
  if (!challenge) return null;
  if (Date.now() - challenge.startedAt < CHAT_CHALLENGE_WINDOW_MS) return null;
  await kv.del(CHAT_CHALLENGE_KEY);
  await kv.set(CHAT_CHALLENGE_LAST_AT_KEY, String(Date.now()));
  const users = Object.keys(challenge.participants);
  if (challenge.messageCount >= challenge.target && users.length > 0) {
    await Promise.all(users.map(u => addTazos(u, challenge.prize)));
    return `🎯 Challenge complete! ${challenge.messageCount}/${challenge.target} messages — ${users.length} chatters each earned ${challenge.prize} tazos!`;
  }
  return `🎯 Challenge failed! Only ${challenge.messageCount}/${challenge.target} messages. Better luck next time!`;
}

export async function shouldStartChatChallenge(): Promise<boolean> {
  const existing = await kv.get<ChatChallengeState>(CHAT_CHALLENGE_KEY);
  if (existing) return false;
  const lastAt = await kv.get<string>(CHAT_CHALLENGE_LAST_AT_KEY);
  const elapsed = lastAt ? Date.now() - parseInt(lastAt, 10) : CHAT_CHALLENGE_INTERVAL_MS;
  return elapsed >= CHAT_CHALLENGE_INTERVAL_MS;
}

// --- Win Streaks ---

const WIN_STREAK_KEY = 'win_streak';
const WIN_STREAK_MILESTONES: Array<[number, number]> = [[3, 25], [5, 50], [10, 150], [15, 500]];

export async function recordWin(username: string): Promise<string> {
  const user = normalizeUser(username);
  try {
    const s = await kv.get<{ winStreaksEnabled?: boolean }>('overlay_settings');
    if (s?.winStreaksEnabled === false) return '';
    const current = parseKvInt(await kv.hget<number>(WIN_STREAK_KEY, user), 0);
    const next = current + 1;
    await kv.hset(WIN_STREAK_KEY, { [user]: next });
    const milestone = WIN_STREAK_MILESTONES.find(([streak]) => streak === next);
    if (milestone) {
      const bonus = milestone[1];
      const bal = await addTazos(user, bonus);
      return ` 🔥 ${next} wins! +${bonus} bonus! (${bal} tazos)`;
    }
    if (next >= 2) return ` 🔥 ${next} streak!`;
  } catch { /* silent */ }
  return '';
}

export async function recordLoss(username: string): Promise<void> {
  const user = normalizeUser(username);
  try { await kv.hset(WIN_STREAK_KEY, { [user]: 0 }); } catch { /* silent */ }
}

// --- Participation Streaks ---

const PARTICIPATION_STREAK_KEY = 'participation_streak';
const PARTICIPATION_MILESTONES: Array<[number, number]> = [[3, 5], [7, 15], [14, 30], [30, 50]];

interface ParticipationData {
  lastDate: string;
  streak: number;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function checkParticipationStreak(username: string): Promise<string | null> {
  const user = normalizeUser(username);
  try {
    const s = await kv.get<{ participationStreaksEnabled?: boolean }>('overlay_settings');
    if (s?.participationStreaksEnabled === false) return null;
    const today = todayDateStr();
    const data = await kv.hget<ParticipationData>(PARTICIPATION_STREAK_KEY, user);
    if (data?.lastDate === today) return null;

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;

    const streak = (data?.lastDate === yesterdayStr) ? (data.streak + 1) : 1;
    await kv.hset(PARTICIPATION_STREAK_KEY, { [user]: JSON.stringify({ lastDate: today, streak }) });

    const milestone = PARTICIPATION_MILESTONES.find(([days]) => days === streak);
    if (milestone) {
      const bonus = milestone[1];
      const bal = await addTazos(user, bonus);
      const display = username.trim();
      return `📅 ${display} — ${streak}-day streak! +${bonus} tazos! (${bal} tazos)`;
    }
  } catch { /* silent */ }
  return null;
}

// --- Boss Events ---

type AttackCategory = 'physical' | 'magic' | 'ranged' | 'special';

const ATTACK_WORDS: Record<string, AttackCategory> = {
  // Physical — melee / wrestling / martial arts
  attack: 'physical', punch: 'physical', kick: 'physical', uppercut: 'physical',
  slap: 'physical', headbutt: 'physical', elbow: 'physical', smash: 'physical',
  crush: 'physical', slam: 'physical', tackle: 'physical', stomp: 'physical',
  chop: 'physical', strike: 'physical', hammer: 'physical', clobber: 'physical',
  suplex: 'physical', clothesline: 'physical', spear: 'physical', roundhouse: 'physical',
  backhand: 'physical', haymaker: 'physical', wallop: 'physical', pummel: 'physical',
  throttle: 'physical', brawl: 'physical', grapple: 'physical', wrangle: 'physical',
  'drop kick': 'physical', 'body slam': 'physical', 'power punch': 'physical',
  'flying kick': 'physical', 'ground pound': 'physical', 'pile driver': 'physical',
  'tombstone': 'physical', 'stone cold stunner': 'physical', rko: 'physical',
  'german suplex': 'physical', 'choke slam': 'physical', 'leg sweep': 'physical',
  'sucker punch': 'physical', 'scissor kick': 'physical', 'karate chop': 'physical',
  'falcon punch': 'physical', 'wombo combo': 'physical', 'peoples elbow': 'physical',
  'five knuckle shuffle': 'physical', 'sweet chin music': 'physical',
  'atomic wedgie': 'physical', 'wet willy': 'physical', 'purple nurple': 'physical',
  'kidney punch': 'physical', 'spinning backfist': 'physical', 'crane kick': 'physical',
  // Magic — spells / elemental / anime
  fireball: 'magic', lightning: 'magic', ice: 'magic', freeze: 'magic',
  thunder: 'magic', blast: 'magic', burn: 'magic', shock: 'magic',
  zap: 'magic', meteor: 'magic', inferno: 'magic', blizzard: 'magic',
  abracadabra: 'magic', kamehameha: 'magic', rasengan: 'magic', hadouken: 'magic',
  enchant: 'magic', conjure: 'magic', hex: 'magic', bewitch: 'magic',
  'lightning bolt': 'magic', 'fire blast': 'magic', 'ice beam': 'magic',
  'thunder strike': 'magic', 'shadow bolt': 'magic', 'arcane blast': 'magic',
  'avada kedavra': 'magic', 'expelliarmus': 'magic', 'shadow realm': 'magic',
  'dark pulse': 'magic', 'mind blast': 'magic', 'soul drain': 'magic',
  'mana burn': 'magic', 'chaos bolt': 'magic', 'void ray': 'magic',
  'eldritch blast': 'magic', moonbeam: 'magic', starfall: 'magic', thunderclap: 'magic',
  'shoryuken': 'magic', 'spirit bomb': 'magic', 'final flash': 'magic',
  'galick gun': 'magic', 'special beam cannon': 'magic', 'dragon fist': 'magic',
  'chidori': 'magic', 'getsuga tensho': 'magic', 'finger of death': 'magic',
  // Ranged — projectiles / throwing / artillery
  shoot: 'ranged', snipe: 'ranged', arrow: 'ranged', throw: 'ranged',
  hurl: 'ranged', launch: 'ranged', fire: 'ranged', aim: 'ranged',
  yeet: 'ranged', boop: 'ranged', fling: 'ranged', catapult: 'ranged',
  trebuchet: 'ranged', tomahawk: 'ranged', boomerang: 'ranged', slingshot: 'ranged',
  'head shot': 'ranged', 'double tap': 'ranged', 'quick shot': 'ranged',
  'power shot': 'ranged', 'triple shot': 'ranged', 'sniper shot': 'ranged',
  'mortar strike': 'ranged', 'carpet bomb': 'ranged', 'orbital strike': 'ranged',
  'poison dart': 'ranged', 'throwing star': 'ranged', 'banana peel': 'ranged',
  'blue shell': 'ranged', 'red shell': 'ranged', 'green shell': 'ranged',
  'rocket launcher': 'ranged', 'nerf dart': 'ranged', 'paper airplane': 'ranged',
  'rubber band': 'ranged', 'spitball': 'ranged', 'water balloon': 'ranged',
  // Special — social / meme / psychological warfare
  insult: 'special', roast: 'special', curse: 'special', taunt: 'special',
  mock: 'special', jinx: 'special', doom: 'special', banish: 'special',
  smite: 'special', nuke: 'special', obliterate: 'special', ratio: 'special',
  cancel: 'special', report: 'special', cope: 'special', seethe: 'special',
  mald: 'special', cringe: 'special', bonk: 'special', banhammer: 'special',
  'yo mama': 'special', 'death stare': 'special', 'dark magic': 'special',
  'soul strike': 'special', 'vibe check': 'special', 'skill issue': 'special',
  'touch grass': 'special', 'no u': 'special', 'talk to the hand': 'special',
  'stink eye': 'special', 'cold shoulder': 'special', 'silent treatment': 'special',
  'cringe attack': 'special', 'brain freeze': 'special', 'deplatform': 'special',
  'unsubscribe': 'special', 'emotional damage': 'special', 'uno reverse': 'special',
  'rickroll': 'special', 'delete system32': 'special', 'skill diff': 'special',
  'gg ez': 'special', 'get rekt': 'special', 'L plus ratio': 'special',
  'ok boomer': 'special', 'thats cap': 'special', 'caught in 4k': 'special',
};

const ATTACK_WORD_LIST = Object.keys(ATTACK_WORDS);

interface BossDefinition {
  name: string;
  maxHp: number;
  weakness: AttackCategory;
  resistance: AttackCategory;
}

const BOSS_ROSTER: BossDefinition[] = [
  // Tier 1 — 400 HP
  { name: 'Ice Poseidon', maxHp: 400, weakness: 'special', resistance: 'physical' },
  { name: 'HamptonBrandon', maxHp: 400, weakness: 'physical', resistance: 'magic' },
  { name: 'Sam', maxHp: 400, weakness: 'magic', resistance: 'special' },
  { name: 'AsianAndy', maxHp: 400, weakness: 'ranged', resistance: 'physical' },
  { name: 'EBZ', maxHp: 400, weakness: 'special', resistance: 'ranged' },
  { name: 'BurgerPlanet', maxHp: 400, weakness: 'physical', resistance: 'special' },
  { name: 'SJC', maxHp: 400, weakness: 'magic', resistance: 'ranged' },
  { name: 'Adin Ross', maxHp: 400, weakness: 'ranged', resistance: 'magic' },
  { name: 'xQc', maxHp: 400, weakness: 'special', resistance: 'physical' },
  { name: 'SNEAKO', maxHp: 400, weakness: 'physical', resistance: 'special' },
  { name: 'Amouranth', maxHp: 400, weakness: 'magic', resistance: 'physical' },
  { name: 'Bradley Martin', maxHp: 400, weakness: 'ranged', resistance: 'special' },
  { name: 'SteveWillDoIt', maxHp: 400, weakness: 'special', resistance: 'magic' },
  { name: 'Andy Dick', maxHp: 400, weakness: 'physical', resistance: 'ranged' },
  // Tier 2 — 350 HP
  { name: 'Mando', maxHp: 350, weakness: 'magic', resistance: 'physical' },
  { name: 'ABZ', maxHp: 350, weakness: 'ranged', resistance: 'special' },
  { name: 'Suspendas', maxHp: 350, weakness: 'special', resistance: 'ranged' },
  { name: 'n3on', maxHp: 350, weakness: 'physical', resistance: 'magic' },
  { name: 'RiceGum', maxHp: 350, weakness: 'magic', resistance: 'special' },
  { name: 'Cobbruvs', maxHp: 350, weakness: 'ranged', resistance: 'physical' },
  { name: 'Clavicular', maxHp: 350, weakness: 'special', resistance: 'magic' },
  { name: 'Robcdee', maxHp: 350, weakness: 'physical', resistance: 'ranged' },
  { name: 'JoeyKaotyk', maxHp: 350, weakness: 'magic', resistance: 'physical' },
  { name: 'PeeguuTV', maxHp: 350, weakness: 'ranged', resistance: 'special' },
  { name: 'Ac7ionman', maxHp: 350, weakness: 'special', resistance: 'physical' },
  { name: 'Jandro', maxHp: 350, weakness: 'physical', resistance: 'special' },
  { name: 'fousey', maxHp: 350, weakness: 'magic', resistance: 'ranged' },
  { name: 'Shotime', maxHp: 350, weakness: 'ranged', resistance: 'magic' },
  // Tier 3 — 300 HP
  { name: 'kangjoel', maxHp: 300, weakness: 'special', resistance: 'ranged' },
  { name: 'TAEMIN1998', maxHp: 300, weakness: 'physical', resistance: 'magic' },
  { name: 'nickwhite', maxHp: 300, weakness: 'magic', resistance: 'special' },
  { name: 'nicklee', maxHp: 300, weakness: 'ranged', resistance: 'physical' },
  { name: 'kimmee', maxHp: 300, weakness: 'special', resistance: 'magic' },
  { name: 'Alexis', maxHp: 300, weakness: 'physical', resistance: 'ranged' },
  { name: 'Hanridge', maxHp: 300, weakness: 'magic', resistance: 'physical' },
  { name: 'Xenathewitch', maxHp: 300, weakness: 'ranged', resistance: 'special' },
  { name: 'Moxie', maxHp: 300, weakness: 'special', resistance: 'physical' },
  { name: 'iDuncle', maxHp: 300, weakness: 'physical', resistance: 'special' },
  { name: 'dtanmanb', maxHp: 300, weakness: 'magic', resistance: 'ranged' },
  { name: 'aloeirl', maxHp: 300, weakness: 'ranged', resistance: 'magic' },
  { name: 'LordHito', maxHp: 300, weakness: 'special', resistance: 'ranged' },
  { name: 'Andy', maxHp: 300, weakness: 'physical', resistance: 'magic' },
  { name: 'ChickenAndy', maxHp: 300, weakness: 'magic', resistance: 'physical' },
  // Tier 4 — 250 HP
  { name: 'jjstream', maxHp: 250, weakness: 'ranged', resistance: 'special' },
  { name: 'shoovy', maxHp: 250, weakness: 'special', resistance: 'physical' },
  { name: 'nanatty', maxHp: 250, weakness: 'physical', resistance: 'ranged' },
  { name: 'wvagabond', maxHp: 250, weakness: 'magic', resistance: 'special' },
  { name: 'Deepak', maxHp: 250, weakness: 'ranged', resistance: 'magic' },
  { name: 'hyubsama', maxHp: 250, weakness: 'special', resistance: 'physical' },
  { name: 'vnthony', maxHp: 250, weakness: 'physical', resistance: 'special' },
  { name: 'CRISTRAVELS', maxHp: 250, weakness: 'magic', resistance: 'ranged' },
  { name: 'Moises', maxHp: 250, weakness: 'ranged', resistance: 'physical' },
  { name: 'bennymack', maxHp: 250, weakness: 'special', resistance: 'magic' },
  { name: 'CaptainGee', maxHp: 250, weakness: 'physical', resistance: 'magic' },
  { name: 'DBR666', maxHp: 250, weakness: 'magic', resistance: 'physical' },
  { name: 'Eddie', maxHp: 250, weakness: 'ranged', resistance: 'special' },
  { name: 'Santamaria', maxHp: 250, weakness: 'special', resistance: 'ranged' },
  // Tier 5 — 200 HP
  { name: 'LettieVision', maxHp: 200, weakness: 'physical', resistance: 'magic' },
  { name: 'AdrianahLee', maxHp: 200, weakness: 'magic', resistance: 'special' },
  { name: 'FloridaBoy', maxHp: 200, weakness: 'ranged', resistance: 'physical' },
  { name: 'garydavid', maxHp: 200, weakness: 'special', resistance: 'ranged' },
  { name: 'Nanapips', maxHp: 200, weakness: 'physical', resistance: 'special' },
  { name: 'DDURANTV', maxHp: 200, weakness: 'magic', resistance: 'physical' },
  { name: 'carldo', maxHp: 200, weakness: 'ranged', resistance: 'magic' },
  { name: 'Slightlyhomeless', maxHp: 200, weakness: 'special', resistance: 'physical' },
  { name: 'Muratstyle', maxHp: 200, weakness: 'physical', resistance: 'ranged' },
  { name: 'mhyochi', maxHp: 200, weakness: 'magic', resistance: 'ranged' },
];

const BOSS_KEY = 'boss_active';
const BOSS_LAST_AT_KEY = 'boss_last_at';
const BOSS_TTL_SEC = 360;
const BOSS_WINDOW_MS = 5 * 60 * 1000;
const BOSS_INTERVAL_MS = 25 * 60 * 1000;
const BOSS_REWARD_POOL = 100;
const BOSS_ATTACK_COOLDOWN_MS = 5_000;
const BOSS_ATTACK_COOLDOWN_KEY = 'boss_attack_cd';
const BOSS_REMINDER_INTERVAL_MS = 60_000;
const BOSS_RECENT_KEY = 'boss_recent_names';
const BOSS_RECENT_MAX = 20;

interface BossState {
  name: string;
  hp: number;
  maxHp: number;
  weakness: AttackCategory;
  resistance: AttackCategory;
  attackers: Record<string, number>;
  startedAt: number;
  lastAttackAt: number;
  reward: number;
}

const BOSS_REMINDER_MESSAGES = [
  (name: string, hp: number, maxHp: number, weakness: string) =>
    `⚔️ ${name} is still wreaking havoc! ${hp}/${maxHp} HP. Weak to ${weakness}! Attack now!`,
  (name: string, hp: number, maxHp: number, weakness: string) =>
    `⚔️ ${name} is destroying everything! ${hp}/${maxHp} HP left. Use ${weakness} attacks!`,
  (name: string, hp: number, maxHp: number, weakness: string) =>
    `⚔️ Nobody's fighting ${name}?! ${hp}/${maxHp} HP. Try ${weakness} moves!`,
  (name: string, hp: number, maxHp: number, weakness: string) =>
    `⚔️ ${name} laughs at your cowardice! ${hp}/${maxHp} HP. ${weakness} is super effective!`,
];

export async function getBossReminder(): Promise<string | null> {
  const boss = await kv.get<BossState>(BOSS_KEY);
  if (!boss) return null;
  const elapsed = Date.now() - boss.startedAt;
  if (elapsed >= BOSS_WINDOW_MS) return null;
  if (elapsed < BOSS_WINDOW_MS / 2) return null;
  if (Date.now() - boss.lastAttackAt < BOSS_REMINDER_INTERVAL_MS) return null;
  const msg = BOSS_REMINDER_MESSAGES[Math.floor(Math.random() * BOSS_REMINDER_MESSAGES.length)];
  return msg(boss.name, boss.hp, boss.maxHp, boss.weakness);
}

export function getAttackList(): string {
  const grouped: Record<string, string[]> = {};
  for (const [word, cat] of Object.entries(ATTACK_WORDS)) {
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(word);
  }
  const MAX_PER_CAT = 6;
  return Object.entries(grouped)
    .map(([cat, words]) => {
      const sample = words.slice(0, MAX_PER_CAT).join(', ');
      const more = words.length > MAX_PER_CAT ? ` +${words.length - MAX_PER_CAT} more` : '';
      return `${cat}: ${sample}${more}`;
    })
    .join(' | ');
}

export async function startBossEvent(): Promise<string> {
  const existing = await kv.get<BossState>(BOSS_KEY);
  if (existing && Date.now() - existing.startedAt < BOSS_WINDOW_MS) {
    const hpPct = Math.round((existing.hp / existing.maxHp) * 100);
    const attackerCount = Object.keys(existing.attackers).length;
    return `⚔️ ${existing.name} is still alive! ${existing.hp}/${existing.maxHp} HP (${hpPct}%). ${attackerCount} attacker${attackerCount !== 1 ? 's' : ''} so far. Weak to ${existing.weakness}!`;
  }
  const recent = (await kv.get<string[]>(BOSS_RECENT_KEY)) ?? [];
  const available = BOSS_ROSTER.filter(b => !recent.includes(b.name));
  const pool = available.length > 0 ? available : BOSS_ROSTER;
  const def = pool[Math.floor(Math.random() * pool.length)];
  const updatedRecent = [...recent, def.name].slice(-BOSS_RECENT_MAX);
  await kv.set(BOSS_RECENT_KEY, updatedRecent);
  const boss: BossState = {
    name: def.name, hp: def.maxHp, maxHp: def.maxHp,
    weakness: def.weakness, resistance: def.resistance,
    attackers: {}, startedAt: Date.now(), lastAttackAt: Date.now(), reward: BOSS_REWARD_POOL,
  };
  await kv.set(BOSS_KEY, boss, { ex: BOSS_TTL_SEC });
  const words = Object.entries(ATTACK_WORDS).reduce((acc, [w, cat]) => {
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(w);
    return acc;
  }, {} as Record<string, string[]>);
  const examples = Object.values(words).map(ws => ws[0]).join(', ');
  return `⚔️ ${def.name} appears! ${def.maxHp} HP. Weak to ${def.weakness}, resists ${def.resistance}. Try: ${examples}`;
}

export async function tryBossAttack(username: string, content: string): Promise<string | null> {
  const word = content.trim().toLowerCase();
  const category = ATTACK_WORDS[word];
  if (!category) return null;
  const boss = await kv.get<BossState>(BOSS_KEY);
  if (!boss) return null;
  if (Date.now() - boss.startedAt >= BOSS_WINDOW_MS) return null;

  const user = normalizeUser(username);
  const display = username.trim();

  const cdKey = `${BOSS_ATTACK_COOLDOWN_KEY}:${user}`;
  const lastAtk = await kv.get<number>(cdKey);
  if (lastAtk && Date.now() - lastAtk < BOSS_ATTACK_COOLDOWN_MS) return null;
  await kv.set(cdKey, Date.now(), { ex: 10 });

  let baseDmg = 5 + Math.floor(Math.random() * 21);
  let effectText = '';
  if (category === boss.weakness) {
    baseDmg *= 2;
    effectText = ' (super effective!)';
  } else if (category === boss.resistance) {
    baseDmg = Math.max(1, Math.ceil(baseDmg / 2));
    effectText = ' (resisted!)';
  }

  boss.hp = Math.max(0, boss.hp - baseDmg);
  boss.attackers[user] = (boss.attackers[user] ?? 0) + baseDmg;
  boss.lastAttackAt = Date.now();
  if (display) await setLeaderboardDisplayName(user, display);

  if (boss.hp <= 0) {
    await kv.del(BOSS_KEY);
    await kv.set(BOSS_LAST_AT_KEY, String(Date.now()));
    const attackerEntries = Object.entries(boss.attackers);
    const totalDmg = attackerEntries.reduce((s, [, d]) => s + d, 0);
    const names = (await kv.hgetall<Record<string, string>>(LEADERBOARD_DISPLAY_NAMES_KEY)) ?? {};
    const rewards: string[] = [];
    for (const [u, dmg] of attackerEntries) {
      const share = Math.max(3, Math.round((dmg / totalDmg) * boss.reward));
      const bal = await addTazos(u, share);
      const dname = names[u] ?? u;
      rewards.push(`${dname} +${share}`);
    }
    return `⚔️ ${word} hits ${boss.name} for ${baseDmg}${effectText} — ${boss.name} defeated! Rewards: ${rewards.join(', ')}`;
  }

  await kv.set(BOSS_KEY, boss, { ex: BOSS_TTL_SEC });
  return `⚔️ ${display} uses ${word} on ${boss.name} for ${baseDmg} dmg${effectText}! (${boss.hp}/${boss.maxHp} HP)`;
}

export async function shouldStartBossEvent(): Promise<boolean> {
  const existing = await kv.get<BossState>(BOSS_KEY);
  if (existing) return false;
  const lastAt = await kv.get<string>(BOSS_LAST_AT_KEY);
  const elapsed = lastAt ? Date.now() - parseInt(lastAt, 10) : BOSS_INTERVAL_MS;
  return elapsed >= BOSS_INTERVAL_MS;
}

export async function resolveExpiredBoss(): Promise<string | null> {
  const boss = await kv.get<BossState>(BOSS_KEY);
  if (!boss) return null;
  if (Date.now() - boss.startedAt < BOSS_WINDOW_MS) return null;
  await kv.del(BOSS_KEY);
  await kv.set(BOSS_LAST_AT_KEY, String(Date.now()));
  return `⚔️ ${boss.name} escaped! Better luck next time.`;
}

// --- Active event check (prevents overlapping events) ---

export async function hasActiveEvent(): Promise<boolean> {
  const [drop, challenge, boss] = await Promise.all([
    kv.get(TAZO_DROP_KEY), kv.get(CHAT_CHALLENGE_KEY), kv.get(BOSS_KEY),
  ]);
  return !!(drop || challenge || boss);
}

export async function resetEventTimestamps(): Promise<void> {
  await Promise.all([
    kv.del(RAFFLE_LAST_AT_KEY),
    kv.del(TAZO_DROP_LAST_AT_KEY),
    kv.del(CHAT_CHALLENGE_LAST_AT_KEY),
    kv.del(BOSS_LAST_AT_KEY),
  ]);
}

// --- Tazo Gifting & Requests ---

const TAZO_REQUEST_KEY_PREFIX = 'tazo_request:';
const TAZO_REQUEST_EXPIRE_SEC = 60;

interface PendingTazoRequest {
  requester: string;
  requesterDisplay: string;
  amount: number;
  createdAt: number;
}

function tazoRequestKey(target: string): string {
  return `${TAZO_REQUEST_KEY_PREFIX}${target}`;
}

export async function giftTazos(senderUsername: string, recipientUsername: string, amount: number): Promise<string> {
  const sender = normalizeUser(senderUsername);
  const recipient = normalizeUser(recipientUsername);
  if (sender === recipient) return '🎁 You can\'t gift tazos to yourself.';
  if (amount < 1) return '🎁 Minimum gift is 1 tazo.';

  const { ok, balance } = await deductTazos(sender, amount);
  if (!ok) return `🎁 Not enough tazos (have ${balance}).`;

  const recipientBal = await addTazos(recipient, amount);
  const senderBal = balance - amount;
  return `🎁 ${senderUsername.trim()} gifted ${amount} tazos to ${recipientUsername.trim()}! (${senderBal} | ${recipientBal} tazos)`;
}

export async function requestTazos(requesterUsername: string, targetUsername: string, amount: number): Promise<string> {
  const requester = normalizeUser(requesterUsername);
  const target = normalizeUser(targetUsername);
  if (requester === target) return '🙏 You can\'t ask yourself for tazos.';
  if (amount < 1) return '🙏 Minimum request is 1 tazo.';

  const req: PendingTazoRequest = {
    requester,
    requesterDisplay: requesterUsername.trim(),
    amount,
    createdAt: Date.now(),
  };
  await kv.set(tazoRequestKey(target), req, { ex: TAZO_REQUEST_EXPIRE_SEC });
  return `🙏 ${requesterUsername.trim()} is asking ${targetUsername.trim()} for ${amount} tazos! accept or deny (60s)`;
}

export async function acceptTazoRequest(targetUsername: string): Promise<string | null> {
  const target = normalizeUser(targetUsername);
  const raw = await kv.get<PendingTazoRequest>(tazoRequestKey(target));
  if (!raw) return null;

  const req = raw as PendingTazoRequest;
  if (Date.now() - req.createdAt > TAZO_REQUEST_EXPIRE_SEC * 1000) {
    await kv.del(tazoRequestKey(target));
    return null;
  }

  const { ok, balance } = await deductTazos(target, req.amount);
  if (!ok) {
    await kv.del(tazoRequestKey(target));
    return `🎁 Not enough tazos to give (have ${balance}). Request cancelled.`;
  }

  const requesterBal = await addTazos(req.requester, req.amount);
  await kv.del(tazoRequestKey(target));
  const targetBal = balance - req.amount;
  return `🎁 ${targetUsername.trim()} gave ${req.requesterDisplay} ${req.amount} tazos! (${targetBal} | ${requesterBal} tazos)`;
}

export async function denyTazoRequest(targetUsername: string): Promise<string | null> {
  const target = normalizeUser(targetUsername);
  const raw = await kv.get<PendingTazoRequest>(tazoRequestKey(target));
  if (!raw) return null;

  const req = raw as PendingTazoRequest;
  await kv.del(tazoRequestKey(target));
  return `❌ ${targetUsername.trim()} denied ${req.requesterDisplay}'s request.`;
}
