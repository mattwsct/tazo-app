/**
 * Blackjack game: gambling chips (separate from leaderboard points), per-user game state.
 * Commands: !deal <amount>, !hit, !stand, !double (2 cards), !split (pairs). Chips and gambling leaderboard reset each stream.
 * New players start with 100 chips.
 */

import { kv } from '@vercel/kv';
import { getLeaderboardExclusions, setLeaderboardDisplayName } from '@/utils/leaderboard-storage';

const VIEW_CHIPS_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const VIEW_CHIPS_PER_INTERVAL = 10;

const CHIPS_BALANCE_KEY = 'blackjack_chips';
const GAMBLING_LEADERBOARD_KEY = 'blackjack_leaderboard';
const DEAL_COOLDOWN_KEY = 'blackjack_deal_last_at';
const VIEW_CHIPS_LAST_AT_KEY = 'blackjack_view_chips_last_at';
const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000; // Auto-stand after 90s
const DEAL_COOLDOWN_MS = 15_000; // Min 15s between starting new hands
const GAMBLE_INSTANT_COOLDOWN_MS = 5_000; // Min 5s between slots/roulette/coinflip/dice
const GAMBLE_INSTANT_LAST_AT_KEY = 'gamble_instant_last_at';
const STARTING_CHIPS = 100;
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

/** Get or create chips balance. New players start with STARTING_CHIPS. */
export async function getChips(username: string): Promise<number> {
  const user = normalizeUser(username);
  try {
    const bal = await kv.hget<number | string>(CHIPS_BALANCE_KEY, user);
    if (bal != null) {
      return typeof bal === 'string' ? parseInt(bal, 10) : Math.floor(bal);
    }
    const init: Promise<unknown>[] = [
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(STARTING_CHIPS) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: STARTING_CHIPS, member: user }),
    ];
    if (username?.trim()) init.push(setLeaderboardDisplayName(user, username.trim()));
    await Promise.all(init);
    return STARTING_CHIPS;
  } catch {
    return STARTING_CHIPS;
  }
}

/** Deduct chips (for bet). Returns { ok, balance } — balance is always current, avoiding an extra KV read on failure. */
async function deductChips(user: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  const bal = await getChips(user);
  if (bal < amount) return { ok: false, balance: bal };
  const newBal = bal - amount;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return { ok: true, balance: newBal };
}

/** Deduct chips for a bet, auto-capping to user's balance if bet exceeds it. */
async function placeBet(user: string, requestedBet: number): Promise<{ ok: false; balance: number } | { ok: true; bet: number; balance: number }> {
  const bal = await getChips(user);
  if (bal < MIN_BET) return { ok: false, balance: bal };
  const bet = Math.min(Math.floor(Math.max(MIN_BET, requestedBet)), bal);
  const newBal = bal - bet;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return { ok: true, bet, balance: newBal };
}

/** Add chips (for win). Returns new balance. */
async function addChips(user: string, amount: number): Promise<number> {
  const bal = await getChips(user);
  const newBal = bal + amount;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
  return newBal;
}

/** Add chips as admin (broadcaster/mod via !addchips). Bypasses gambling check and exclusions. */
export async function addChipsAsAdmin(username: string, amount: number): Promise<number> {
  const user = normalizeUser(username);
  if (amount < 1) return 0;
  await addChips(user, amount);
  if (username?.trim()) await setLeaderboardDisplayName(user, username.trim());
  return amount;
}

/** Add chips for channel point reward redemption. Returns chips added, or 0 if skipped (gambling off, excluded, or invalid). */
export async function addChipsForReward(username: string, amount: number): Promise<number> {
  const user = normalizeUser(username);
  if (!(await isGamblingEnabled())) return 0;
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return 0;
  if (amount < 1) return 0;
  await addChips(user, amount);
  return amount;
}

/** Award chips for watch time (chat as heartbeat). 10 chips per 10 min, max 10 per chat (no backpay). */
export async function addViewTimeChips(username: string): Promise<number> {
  const user = normalizeUser(username);
  if (!(await isGamblingEnabled())) return 0;
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return 0;

  try {
    const now = Date.now();
    const lastAt = parseKvInt(await kv.hget<number | string>(VIEW_CHIPS_LAST_AT_KEY, user));
    const elapsed = lastAt > 0 ? now - lastAt : VIEW_CHIPS_INTERVAL_MS;
    const intervals = Math.floor(elapsed / VIEW_CHIPS_INTERVAL_MS);
    if (intervals < 1) return 0;

    const bal = await getChips(user);
    if (bal >= STARTING_CHIPS) return 0;

    // Cap at 1 interval per chat, and don't exceed STARTING_CHIPS
    const chipsToAdd = Math.min(Math.min(intervals, 1) * VIEW_CHIPS_PER_INTERVAL, STARTING_CHIPS - bal);
    if (chipsToAdd <= 0) return 0;
    const newBal = bal + chipsToAdd;
    const updates: Promise<unknown>[] = [
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
      kv.hset(VIEW_CHIPS_LAST_AT_KEY, { [user]: String(now) }),
    ];
    if (username?.trim()) updates.push(setLeaderboardDisplayName(user, username.trim()));
    await Promise.all(updates);
    return chipsToAdd;
  } catch {
    return 0;
  }
}


/** Reset chips and gambling leaderboard on stream start. */
export async function resetGamblingOnStreamStart(): Promise<void> {
  try {
    await Promise.all([
      kv.del(CHIPS_BALANCE_KEY),
      kv.del(GAMBLING_LEADERBOARD_KEY),
      kv.del(DEAL_COOLDOWN_KEY),
      kv.del(VIEW_CHIPS_LAST_AT_KEY),
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
    return `🃏 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
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
      const bal = await addChips(user, bet);
      await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
      return `🃏 Push! Both have 21. ${bet} chips returned. (${bal} chips)`;
    }
    const win = Math.floor(bet * 1.5);
    const bal = await addChips(user, bet + win);
    await kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) });
    return `🃏 Blackjack! Won ${win} chips! (${bal} chips)`;
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
  const extras = isPair(playerHand) ? ' | !double (2 cards) | !split (pair)' : ' | !double (2 cards)';
  return `🃏 Your hand: ${formatHand(playerHand)} (${playerVal.value}) | Dealer: ${dealerVis} | Bet: ${bet} — !hit or !stand${extras}`;
}

/** Double - double bet, take one card, stand. Only when 2 cards and not split. */
export async function double(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return NO_ACTIVE_HAND_MSG;
  if (game.split) return `🃏 Can't !double on split hands. Use !hit or !stand.`;
  if (game.playerHand.length !== 2) return `🃏 !double only on first 2 cards. Use !hit or !stand.`;

  const extraBet = game.bet;
  const { ok, balance } = await deductChips(user, extraBet);
  if (!ok) {
    return `🃏 Not enough chips to double (need ${extraBet} more, have ${balance}).`;
  }

  const card = game.deck.pop()!;
  game.playerHand.push(card);
  const { value } = handValue(game.playerHand);

  if (value > 21) {
    await kv.del(gameKey(user));
    const bal = await getChips(user);
    return `🃏 Double bust! Drew ${cardDisplay(card)} — ${formatHand(game.playerHand)} = ${value}. Lost ${game.bet * 2} chips. (${bal} chips)`;
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
  if (game.split) return `🃏 Already split. Use !hit or !stand.`;
  if (!isPair(game.playerHand)) return `🃏 !split only on pairs. Use !hit or !stand.`;

  const extraBet = game.bet;
  const { ok, balance } = await deductChips(user, extraBet);
  if (!ok) {
    return `🃏 Not enough chips to split (need ${extraBet} more). You have ${balance}.`;
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
  return `🃏 Split! Hand 1: ${formatHand(game.playerHand)} (${v1}) — !hit or !stand (Hand 2: ${formatHand(game.playerHand2!)} waits)`;
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
          const bal = await getChips(user);
          return `🃏 Hand 1 bust! Hand 2: ${formatHand(game.playerHand2!)} (${v2}) also bust. Lost ${game.bet + game.bet2!} chips. (${bal} chips)`;
        }
        return `🃏 Hand 1 bust! Hand 2: ${formatHand(game.playerHand2!)} (${v2}) — !hit or !stand`;
      } else {
        await kv.del(gameKey(user));
        const bal = await getChips(user);
        return `🃏 Hand 2 bust! ${formatHand(game.playerHand2!)} = ${value}. Lost ${game.bet + game.bet2!} chips. (${bal} chips)`;
      }
    }
    await kv.del(gameKey(user));
    const bal = await getChips(user);
    return `🃏 Bust! ${formatHand(game.playerHand)} = ${value}. Lost ${game.bet} chips. (${bal} chips)`;
  }

  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  const handLabel = game.split ? (isHand1 ? 'Hand 1' : 'Hand 2') : 'Your hand';
  return `🃏 Drew ${cardDisplay(card)}. ${handLabel}: ${formatHand(hand)} (${value}) — !hit or !stand`;
}

function resolveHand(
  dealerVal: number,
  playerVal: number,
  bet: number,
): { win: number; msg: string } {
  if (dealerVal > 21) return { win: bet * 2, msg: `Dealer busts! You win ${bet} chips (${bet * 2} back)` };
  if (dealerVal > playerVal) return { win: 0, msg: `Dealer wins ${dealerVal} vs ${playerVal} — lost ${bet} chips` };
  if (dealerVal < playerVal) return { win: bet * 2, msg: `You win ${playerVal} vs ${dealerVal}! +${bet} chips (${bet * 2} back)` };
  return { win: bet, msg: `Push — ${bet} chips returned` };
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
    return `🃏 Hand 1 stood. Hand 2: ${formatHand(game.playerHand2!)} (${v2}) — !hit or !stand`;
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
    const r1 = v1 <= 21 ? resolveHand(dealerVal, v1, game.bet) : { win: 0, msg: `Bust — lost ${game.bet} chips` };
    const r2 = v2 <= 21 ? resolveHand(dealerVal, v2, game.bet2!) : { win: 0, msg: `Bust — lost ${game.bet2!} chips` };
    const totalWin = r1.win + r2.win;
    const totalBet = game.bet + game.bet2!;
    const bal = totalWin > 0 ? await addChips(user, totalWin) : await getChips(user);
    await kv.del(gameKey(user));
    const net = totalWin - totalBet;
    return `🃏 Dealer: ${formatHand(dealerHand)} (${dealerVal}) | H1: ${r1.msg} | H2: ${r2.msg} | Net: ${net >= 0 ? '+' : ''}${net} chips (${bal} chips)`;
  }

  const playerVal = handValue(game.playerHand).value;
  const { win, msg } = resolveHand(dealerVal, playerVal, game.bet);
  const bal = win > 0 ? await addChips(user, win) : await getChips(user);
  await kv.del(gameKey(user));
  return `🃏 Dealer: ${formatHand(dealerHand)} (${dealerVal}) | ${msg} (${bal} chips)`;
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
  if (!result.ok) return `🎲 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;
  await setInstantCooldown(user);

  if (Math.random() < 0.5) {
    const bal = await addChips(user, bet * 2);
    const streak = await recordWin(user);
    return `🎲 You won ${bet} chips! (${bal} chips)${streak}`;
  }
  await recordLoss(user);
  return `🎲 You lost ${bet} chips. (${result.balance} chips)`;
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
  if (!result.ok) return `🎰 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
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
    const bal = await addChips(user, win);
    const streak = await recordWin(user);
    return `🎰 [ ${display} ] JACKPOT! ${mult}x — Won ${win - bet} chips! (${bal} chips)${streak}`;
  }
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    const match = reels[0] === reels[1] ? reels[0] : reels[1];
    const mult = Math.max(1, Math.floor(SLOT_MULTIPLIERS[match] / 2));
    const win = bet * mult;
    const bal = await addChips(user, win);
    const net = win - bet;
    if (net > 0) {
      const streak = await recordWin(user);
      return `🎰 [ ${display} ] Two match! ${mult}x — Won ${net} chips! (${bal} chips)${streak}`;
    }
    return `🎰 [ ${display} ] Two match — ${bet} chips returned. (${bal} chips)`;
  }
  await recordLoss(user);
  return `🎰 [ ${display} ] No match — lost ${bet} chips. (${result.balance} chips)`;
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
  if (!result.ok) return `🎡 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;
  await setInstantCooldown(user);

  const spin = Math.floor(Math.random() * 37);
  const spinRed = ROULETTE_RED.has(spin);
  const spinBlack = spin >= 1 && spin <= 36 && !spinRed;
  const spinStr = spin === 0 ? '0 (green)' : `${spin} (${spinRed ? 'red' : spinBlack ? 'black' : 'green'})`;

  if (isRed) {
    if (spinRed) {
      const bal = await addChips(user, bet * 2);
      const streak = await recordWin(user);
      return `🎡 [ ${spinStr} ] Red wins! Won ${bet} chips! (${bal} chips)${streak}`;
    }
    await recordLoss(user);
    return `🎡 [ ${spinStr} ] Red lost — lost ${bet} chips. (${result.balance} chips)`;
  }
  if (isBlack) {
    if (spinBlack) {
      const bal = await addChips(user, bet * 2);
      const streak = await recordWin(user);
      return `🎡 [ ${spinStr} ] Black wins! Won ${bet} chips! (${bal} chips)${streak}`;
    }
    await recordLoss(user);
    return `🎡 [ ${spinStr} ] Black lost — lost ${bet} chips. (${result.balance} chips)`;
  }
  if (spin === numBet) {
    const win = bet * 36;
    const bal = await addChips(user, win);
    const streak = await recordWin(user);
    return `🎡 [ ${spinStr} ] NUMBER HIT! 36x — Won ${win - bet} chips! (${bal} chips)${streak}`;
  }
  await recordLoss(user);
  return `🎡 [ ${spinStr} ] Wrong number — lost ${bet} chips. (${result.balance} chips)`;
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
  if (!result.ok) return `🎲 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;
  await setInstantCooldown(user);

  const roll = Math.floor(Math.random() * 6) + 1;
  const won = (isHigh && roll >= 4) || (isLow && roll <= 3);
  if (won) {
    const bal = await addChips(user, bet * 2);
    const streak = await recordWin(user);
    return `🎲 Rolled ${roll} (${isHigh ? 'high' : 'low'}) — Won ${bet} chips! (${bal} chips)${streak}`;
  }
  await recordLoss(user);
  return `🎲 Rolled ${roll} (${roll >= 4 ? 'high' : 'low'}) — Lost ${bet} chips. (${result.balance} chips)`;
}

// --- Crash ---

/** Crash: pick a cashout target (default 2x). Crash point is random; if >= target you win target * bet. */
export async function playCrash(username: string, betAmount: number, targetMultiplier?: number): Promise<string> {
  const user = normalizeUser(username);
  const target = Math.max(1.1, targetMultiplier ?? 2);

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `💥 Wait ${wait}s before another game.`;

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `💥 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;
  await setInstantCooldown(user);

  // House edge ~3%. Crash point distribution: mostly low, occasionally very high.
  const r = Math.random();
  const crashPoint = Math.max(1, Math.floor(100 / (1 - r * 0.97)) / 100);

  const crashStr = crashPoint.toFixed(2) + 'x';
  const targetStr = target.toFixed(2) + 'x';

  if (crashPoint >= target) {
    const win = Math.floor(bet * target);
    const bal = await addChips(user, win);
    const streak = await recordWin(user);
    return `💥 Crashed at ${crashStr} — Cashed out at ${targetStr}! Won ${win - bet} chips! (${bal} chips)${streak}`;
  }
  await recordLoss(user);
  return `💥 Crashed at ${crashStr} — Target was ${targetStr}. Lost ${bet} chips. (${result.balance} chips)`;
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
  if (!result.ok) return `⚔️ Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
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
    const bal = await addChips(user, bet * 2);
    const streak = await recordWin(user);
    return `⚔️ You: ${playerCard}${suitP} vs Dealer: ${dealerCard}${suitD} — Won ${bet} chips! (${bal} chips)${streak}`;
  }
  if (pVal < dVal) {
    await recordLoss(user);
    return `⚔️ You: ${playerCard}${suitP} vs Dealer: ${dealerCard}${suitD} — Dealer wins. Lost ${bet} chips. (${result.balance} chips)`;
  }
  const bal = await addChips(user, bet);
  return `⚔️ You: ${playerCard}${suitP} vs Dealer: ${dealerCard}${suitD} — Tie! ${bet} chips returned. (${bal} chips)`;
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
  if (!result.ok) return `⚔️ Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;

  const duel: PendingDuel = {
    challenger,
    challengerDisplay: challengerUsername.trim(),
    bet,
    createdAt: Date.now(),
  };
  await kv.set(duelKey(target), duel, { ex: DUEL_EXPIRE_SEC });
  await setInstantCooldown(challenger);

  return `⚔️ ${challengerUsername.trim()} challenges ${targetUsername.trim()} to a ${bet}-chip duel! Type !accept within 60s.`;
}

/** Accept a pending duel. Both players' chips are at stake, 50/50 winner takes all. */
export async function acceptDuel(accepterUsername: string): Promise<string> {
  const accepter = normalizeUser(accepterUsername);
  const raw = await kv.get<PendingDuel>(duelKey(accepter));
  if (!raw) return `⚔️ No pending duel. Someone can challenge you with !duel @${accepterUsername.trim()} <amount>`;

  const duel = raw as PendingDuel;
  if (Date.now() - duel.createdAt > DUEL_EXPIRE_SEC * 1000) {
    await kv.del(duelKey(accepter));
    await addChips(duel.challenger, duel.bet);
    return `⚔️ Duel expired. ${duel.challengerDisplay}'s ${duel.bet} chips refunded.`;
  }

  const { ok, balance } = await deductChips(accepter, duel.bet);
  if (!ok) {
    await kv.del(duelKey(accepter));
    await addChips(duel.challenger, duel.bet);
    return `⚔️ Not enough chips (need ${duel.bet}, have ${balance}). Duel cancelled, ${duel.challengerDisplay}'s chips returned.`;
  }

  await kv.del(duelKey(accepter));

  const totalPot = duel.bet * 2;
  const challengerWins = Math.random() < 0.5;
  const winner = challengerWins ? duel.challenger : accepter;
  const winnerDisplay = challengerWins ? duel.challengerDisplay : accepterUsername.trim();
  const loserDisplay = challengerWins ? accepterUsername.trim() : duel.challengerDisplay;

  const bal = await addChips(winner, totalPot);

  return `⚔️ ${winnerDisplay} defeats ${loserDisplay}! Won ${totalPot} chips! (${bal} chips)`;
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
      const bal = await addChips(p.user, payout);
      payouts.push(`${p.display} +${payout - p.bet} (${bal})`);
    }
    return `🏦💰 HEIST SUCCEEDED! ${numPlayers} robber${numPlayers > 1 ? 's' : ''} split the loot! ${payouts.join(', ')}`;
  }

  return `🏦🚔 HEIST FAILED! Police caught ${numPlayers === 1 ? 'the lone robber' : `all ${numPlayers} robbers`}! ${totalPot} chips lost.`;
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
    if (!result.ok) return `🏦 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
    const { bet } = result;
    await setInstantCooldown(user);

    existing.participants.push({ user, display, bet });
    await kv.set(HEIST_KEY, existing, { ex: HEIST_TTL_SEC });

    const totalPot = existing.participants.reduce((sum, p) => sum + p.bet, 0);
    const rate = heistSuccessRate(existing.participants.length);
    const timeLeft = Math.ceil((HEIST_JOIN_WINDOW_MS - (Date.now() - existing.startedAt)) / 1000);

    return `🏦 ${display} joins the heist with ${bet} chips! (${existing.participants.length} robbers, ${totalPot} at stake, ${rate}% odds, ${timeLeft}s left)`;
  }

  const result = await placeBet(user, betAmount);
  if (!result.ok) return `🏦 Not enough chips (${result.balance}). Chat to earn more or redeem channel points.`;
  const { bet } = result;
  await setInstantCooldown(user);

  const newHeist: HeistState = {
    participants: [{ user, display, bet }],
    startedAt: Date.now(),
  };
  await kv.set(HEIST_KEY, newHeist, { ex: HEIST_TTL_SEC });

  return `🏦 HEIST STARTED! ${display} bets ${bet} chips. Type !heist [amount] to join! (60s)`;
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
const RAFFLE_TTL_SEC = 600; // 10 min TTL safety net (well beyond entry window + cron interval)
const RAFFLE_ENTRY_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const RAFFLE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between raffles
const RAFFLE_DEFAULT_PRIZE = 50;

const RAFFLE_KEYWORDS = [
  'tazo', 'wazo', 'lazo', 'ratzo', 'gayzo', 'nontent',
  'yoink', 'poggers', 'monke', 'bonk', 'sheesh', 'vibes',
  'bruh', 'noice', 'stonks', 'woop', 'snag', 'bingo',
  'lemon', 'mango', 'panda', 'cobra', 'pixel', 'turbo',
  'blaze', 'crispy', 'groovy', 'zippy', 'chunky', 'spicy',
  'ninja', 'wizard', 'goblin', 'yeet', 'dingo', 'quack',
  'noodle', 'taco', 'waffle', 'banana', 'rocket', 'thunder',
];

function pickRaffleKeyword(): string {
  return RAFFLE_KEYWORDS[Math.floor(Math.random() * RAFFLE_KEYWORDS.length)];
}

interface RaffleState {
  participants: Array<{ user: string; display: string }>;
  startedAt: number;
  prize: number;
  keyword: string;
}

/** Start a new raffle. Returns announcement message. */
export async function startRaffle(prize = RAFFLE_DEFAULT_PRIZE): Promise<string> {
  const existing = await kv.get<RaffleState>(RAFFLE_KEY);
  if (existing && Date.now() - existing.startedAt < RAFFLE_ENTRY_WINDOW_MS) {
    const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - (Date.now() - existing.startedAt)) / 1000);
    return `🎰 Raffle already active! Type '${existing.keyword}' to enter (${timeLeft}s left).`;
  }
  const keyword = pickRaffleKeyword();
  const raffle: RaffleState = {
    participants: [],
    startedAt: Date.now(),
    prize,
    keyword,
  };
  await kv.set(RAFFLE_KEY, raffle, { ex: RAFFLE_TTL_SEC });
  return `🎰 RAFFLE! Type '${keyword}' in chat to enter! Drawing in 2 minutes — winner gets ${prize} chips!`;
}

/** Try to enter a raffle via keyword match. Returns reply if matched, null otherwise (silent for non-matches). */
export async function tryRaffleKeywordEntry(username: string, content: string): Promise<string | null> {
  const word = content.trim().toLowerCase();
  if (!word || word.length > 20) return null;

  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  if (Date.now() - raffle.startedAt >= RAFFLE_ENTRY_WINDOW_MS) return null;
  if (word !== raffle.keyword) return null;

  const user = normalizeUser(username);
  const display = username.trim();
  if (raffle.participants.some(p => p.user === user)) return null;

  raffle.participants.push({ user, display });
  await kv.set(RAFFLE_KEY, raffle, { ex: RAFFLE_TTL_SEC });
  return `🎰 ${display} joined the raffle! (${raffle.participants.length} entered)`;
}

/** Resolve the active raffle. Returns result message or null if nothing to resolve. */
export async function resolveRaffle(): Promise<string | null> {
  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  if (Date.now() - raffle.startedAt < RAFFLE_ENTRY_WINDOW_MS) return null;

  await kv.del(RAFFLE_KEY);
  await kv.set(RAFFLE_LAST_AT_KEY, String(Date.now()));

  if (raffle.participants.length === 0) return null;

  const winner = raffle.participants[Math.floor(Math.random() * raffle.participants.length)];
  const bal = await addChips(winner.user, raffle.prize);
  if (winner.display) await setLeaderboardDisplayName(winner.user, winner.display);

  return `🎰 RAFFLE WINNER! ${winner.display} wins ${raffle.prize} chips! (${bal} chips)`;
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
  const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - (Date.now() - raffle.startedAt)) / 1000);
  return `🎰 Active raffle: ${raffle.participants.length} entered, ${raffle.prize} chip prize, ${timeLeft}s left. Type '${raffle.keyword}' to enter!`;
}

/** Get a mid-raffle reminder if the raffle is roughly halfway through (50-75% of entry window). */
export async function getRaffleReminder(): Promise<string | null> {
  const raffle = await kv.get<RaffleState>(RAFFLE_KEY);
  if (!raffle) return null;
  const elapsed = Date.now() - raffle.startedAt;
  const halfPoint = RAFFLE_ENTRY_WINDOW_MS * 0.5;
  const threeQuarterPoint = RAFFLE_ENTRY_WINDOW_MS * 0.75;
  if (elapsed < halfPoint || elapsed >= threeQuarterPoint) return null;
  const timeLeft = Math.ceil((RAFFLE_ENTRY_WINDOW_MS - elapsed) / 1000);
  return `🎰 Raffle ending soon! ${raffle.participants.length} entered so far — type '${raffle.keyword}' to enter! (${timeLeft}s left, ${raffle.prize} chips)`;
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

  const bal = await addChips(winner.user, TOP_CHATTER_PRIZE);
  const names = (await kv.hgetall<Record<string, string>>(LEADERBOARD_DISPLAY_NAMES_KEY)) ?? {};
  const displayName = names[winner.user] ?? winner.user;

  return `💬 Top chatter this hour: ${displayName} (${winner.count} messages) — +${TOP_CHATTER_PRIZE} chips! (${bal} chips)`;
}

// --- Chip Drops ---

const CHIP_DROP_KEY = 'chip_drop_active';
const CHIP_DROP_LAST_AT_KEY = 'chip_drop_last_at';
const CHIP_DROP_TTL_SEC = 180;
const CHIP_DROP_WINDOW_MS = 2 * 60 * 1000;
const CHIP_DROP_INTERVAL_MS = 15 * 60 * 1000;
const CHIP_DROP_PRIZE = 5;
const CHIP_DROP_MAX_WINNERS = 5;

interface ChipDropState {
  keyword: string;
  prize: number;
  maxWinners: number;
  winners: Array<{ user: string; display: string }>;
  startedAt: number;
}

export async function startChipDrop(prize = CHIP_DROP_PRIZE, maxWinners = CHIP_DROP_MAX_WINNERS): Promise<string> {
  const keyword = RAFFLE_KEYWORDS[Math.floor(Math.random() * RAFFLE_KEYWORDS.length)];
  const drop: ChipDropState = { keyword, prize, maxWinners, winners: [], startedAt: Date.now() };
  await kv.set(CHIP_DROP_KEY, drop, { ex: CHIP_DROP_TTL_SEC });
  return `💧 Chip drop! First ${maxWinners} to type '${keyword}' get ${prize} chips!`;
}

export async function tryChipDropEntry(username: string, content: string): Promise<string | null> {
  const word = content.trim().toLowerCase();
  if (!word || word.length > 20) return null;
  const drop = await kv.get<ChipDropState>(CHIP_DROP_KEY);
  if (!drop) return null;
  if (Date.now() - drop.startedAt >= CHIP_DROP_WINDOW_MS) return null;
  if (word !== drop.keyword) return null;
  const user = normalizeUser(username);
  if (drop.winners.some(w => w.user === user)) return null;
  const display = username.trim();
  drop.winners.push({ user, display });
  const bal = await addChips(user, drop.prize);
  if (display) await setLeaderboardDisplayName(user, display);
  const full = drop.winners.length >= drop.maxWinners;
  if (full) {
    await kv.del(CHIP_DROP_KEY);
    await kv.set(CHIP_DROP_LAST_AT_KEY, String(Date.now()));
    return `💧 ${display} grabbed ${drop.prize} chips! (${bal} chips) — Drop complete!`;
  }
  await kv.set(CHIP_DROP_KEY, drop, { ex: CHIP_DROP_TTL_SEC });
  return `💧 ${display} grabbed ${drop.prize} chips! (${bal} chips) — ${drop.maxWinners - drop.winners.length} left!`;
}

export async function shouldStartChipDrop(): Promise<boolean> {
  const existing = await kv.get<ChipDropState>(CHIP_DROP_KEY);
  if (existing) return false;
  const lastAt = await kv.get<string>(CHIP_DROP_LAST_AT_KEY);
  const elapsed = lastAt ? Date.now() - parseInt(lastAt, 10) : CHIP_DROP_INTERVAL_MS;
  return elapsed >= CHIP_DROP_INTERVAL_MS;
}

export async function resolveExpiredChipDrop(): Promise<string | null> {
  const drop = await kv.get<ChipDropState>(CHIP_DROP_KEY);
  if (!drop) return null;
  if (Date.now() - drop.startedAt < CHIP_DROP_WINDOW_MS) return null;
  await kv.del(CHIP_DROP_KEY);
  await kv.set(CHIP_DROP_LAST_AT_KEY, String(Date.now()));
  if (drop.winners.length === 0) return null;
  const names = drop.winners.map(w => w.display).join(', ');
  return `💧 Drop ended! ${drop.winners.length} grabbed chips: ${names}`;
}

// --- Chat Challenges ---

const CHAT_CHALLENGE_KEY = 'chat_challenge_active';
const CHAT_CHALLENGE_LAST_AT_KEY = 'chat_challenge_last_at';
const CHAT_CHALLENGE_TTL_SEC = 180;
const CHAT_CHALLENGE_WINDOW_MS = 2 * 60 * 1000;
const CHAT_CHALLENGE_INTERVAL_MS = 25 * 60 * 1000;
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
  return `🎯 CHAT CHALLENGE! Send ${target} messages in 2 minutes and everyone gets ${prize} chips! Go go go!`;
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
    await Promise.all(users.map(u => addChips(u, challenge.prize)));
    return `🎯 Challenge complete! ${challenge.messageCount}/${challenge.target} messages — ${users.length} chatters each earned ${challenge.prize} chips!`;
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
const WIN_STREAK_MILESTONES: Array<[number, number]> = [[3, 3], [5, 10], [10, 25]];

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
      const bal = await addChips(user, bonus);
      return ` 🔥 ${next} wins in a row! +${bonus} bonus! (${bal} chips)`;
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
      const bal = await addChips(user, bonus);
      const display = username.trim();
      return `📅 ${display} — ${streak}-day chat streak! +${bonus} chips! (${bal} chips)`;
    }
  } catch { /* silent */ }
  return null;
}

// --- Boss Events ---

type AttackCategory = 'physical' | 'magic' | 'ranged' | 'special';

const ATTACK_WORDS: Record<string, AttackCategory> = {
  attack: 'physical', punch: 'physical', kick: 'physical', uppercut: 'physical',
  slap: 'physical', headbutt: 'physical', elbow: 'physical',
  fireball: 'magic', lightning: 'magic', ice: 'magic', freeze: 'magic',
  thunder: 'magic', blast: 'magic',
  shoot: 'ranged', snipe: 'ranged', arrow: 'ranged', throw: 'ranged',
  insult: 'special', roast: 'special', curse: 'special', hex: 'special',
};

const ATTACK_WORD_LIST = Object.keys(ATTACK_WORDS);

interface BossDefinition {
  name: string;
  maxHp: number;
  weakness: AttackCategory;
  resistance: AttackCategory;
}

const BOSS_ROSTER: BossDefinition[] = [
  { name: 'Goblin', maxHp: 300, weakness: 'physical', resistance: 'magic' },
  { name: 'Dragon', maxHp: 600, weakness: 'magic', resistance: 'physical' },
  { name: 'Kraken', maxHp: 500, weakness: 'ranged', resistance: 'physical' },
  { name: 'Troll', maxHp: 400, weakness: 'magic', resistance: 'ranged' },
  { name: 'Skeleton King', maxHp: 500, weakness: 'special', resistance: 'physical' },
  { name: 'Shadow Witch', maxHp: 400, weakness: 'physical', resistance: 'magic' },
  { name: 'Ice Giant', maxHp: 600, weakness: 'magic', resistance: 'ranged' },
  { name: 'Rat King', maxHp: 300, weakness: 'ranged', resistance: 'special' },
];

const BOSS_KEY = 'boss_active';
const BOSS_LAST_AT_KEY = 'boss_last_at';
const BOSS_TTL_SEC = 360;
const BOSS_WINDOW_MS = 5 * 60 * 1000;
const BOSS_INTERVAL_MS = 50 * 60 * 1000;
const BOSS_REWARD_POOL = 100;
const BOSS_ATTACK_COOLDOWN_MS = 5_000;
const BOSS_ATTACK_COOLDOWN_KEY = 'boss_attack_cd';

interface BossState {
  name: string;
  hp: number;
  maxHp: number;
  weakness: AttackCategory;
  resistance: AttackCategory;
  attackers: Record<string, number>;
  startedAt: number;
  reward: number;
}

export async function startBossEvent(): Promise<string> {
  const existing = await kv.get<BossState>(BOSS_KEY);
  if (existing && Date.now() - existing.startedAt < BOSS_WINDOW_MS) {
    const hpPct = Math.round((existing.hp / existing.maxHp) * 100);
    const attackerCount = Object.keys(existing.attackers).length;
    return `⚔️ ${existing.name} is still alive! ${existing.hp}/${existing.maxHp} HP (${hpPct}%). ${attackerCount} attacker${attackerCount !== 1 ? 's' : ''} so far. Weak to ${existing.weakness}!`;
  }
  const def = BOSS_ROSTER[Math.floor(Math.random() * BOSS_ROSTER.length)];
  const boss: BossState = {
    name: def.name, hp: def.maxHp, maxHp: def.maxHp,
    weakness: def.weakness, resistance: def.resistance,
    attackers: {}, startedAt: Date.now(), reward: BOSS_REWARD_POOL,
  };
  await kv.set(BOSS_KEY, boss, { ex: BOSS_TTL_SEC });
  const words = Object.entries(ATTACK_WORDS).reduce((acc, [w, cat]) => {
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(w);
    return acc;
  }, {} as Record<string, string[]>);
  const examples = Object.values(words).map(ws => ws[0]).join(' ');
  return `⚔️ A Wild ${def.name} appears! ${def.maxHp} HP. Weak to ${def.weakness}, resists ${def.resistance}. Try: ${examples}`;
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

  // Per-user cooldown
  const cdKey = `${BOSS_ATTACK_COOLDOWN_KEY}:${user}`;
  const lastAttack = await kv.get<number>(cdKey);
  if (lastAttack && Date.now() - lastAttack < BOSS_ATTACK_COOLDOWN_MS) return null;
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
      const bal = await addChips(u, share);
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
  return `⚔️ The ${boss.name} escaped! Better luck next time.`;
}

// --- Active event check (prevents overlapping events) ---

export async function hasActiveEvent(): Promise<boolean> {
  const [raffle, drop, challenge, boss] = await Promise.all([
    kv.get(RAFFLE_KEY), kv.get(CHIP_DROP_KEY), kv.get(CHAT_CHALLENGE_KEY), kv.get(BOSS_KEY),
  ]);
  return !!(raffle || drop || challenge || boss);
}
