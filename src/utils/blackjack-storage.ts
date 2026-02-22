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
const REBUYS_KEY = 'blackjack_rebuys';
const VIEW_CHIPS_LAST_AT_KEY = 'blackjack_view_chips_last_at';
const LEADERBOARD_DISPLAY_NAMES_KEY = 'leaderboard_display_names';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000; // Auto-stand after 90s
const DEAL_COOLDOWN_MS = 15_000; // Min 15s between starting new hands
const GAMBLE_INSTANT_COOLDOWN_MS = 5_000; // Min 5s between slots/roulette/coinflip/dice
const GAMBLE_INSTANT_LAST_AT_KEY = 'gamble_instant_last_at';
const STARTING_CHIPS = 100;
const REBUY_CHIPS = 50;
const REBUYS_PER_STREAM = 1;
const MIN_BET = 5;
const MAX_BET = 50;

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
  return card; // e.g. "K♥" "A♠"
}

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

/** Add chips (for win). */
async function addChips(user: string, amount: number): Promise<void> {
  const bal = await getChips(user);
  const newBal = bal + amount;
  await Promise.all([
    kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
    kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
  ]);
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

    // Cap at 1 interval per chat so you can't save up 2 hours and claim 120 chips
    const chipsToAdd = Math.min(intervals, 1) * VIEW_CHIPS_PER_INTERVAL;
    const bal = await getChips(user);
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

/** Refill chips when at 0. Returns message. Limited to REBUYS_PER_STREAM per user per stream. */
export async function refillChips(username: string): Promise<string> {
  const user = normalizeUser(username);
  const chips = await getChips(user);
  if (chips > 0) {
    return `🃏 You have ${chips} chips. !refill only works when you have 0. Use !deal <amount> to play.`;
  }
  try {
    const used = parseKvInt(await kv.hget<number | string>(REBUYS_KEY, user));
    if (used >= REBUYS_PER_STREAM) {
      return `🃏 You've already used your ${REBUYS_PER_STREAM} rebu${REBUYS_PER_STREAM === 1 ? 'y' : 'ys'} this stream. Chips reset when the stream starts.`;
    }
    await Promise.all([
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(REBUY_CHIPS) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: REBUY_CHIPS, member: user }),
      kv.hset(REBUYS_KEY, { [user]: String(used + 1) }),
      setLeaderboardDisplayName(user, username.trim()),
    ]);
    return `🃏 Rebuy! You have ${REBUY_CHIPS} chips. !deal <amount> to play.`;
  } catch {
    return `🃏 Rebuy failed. Try again.`;
  }
}

/** Reset chips and gambling leaderboard on stream start. */
export async function resetGamblingOnStreamStart(): Promise<void> {
  try {
    await Promise.all([
      kv.del(CHIPS_BALANCE_KEY),
      kv.del(GAMBLING_LEADERBOARD_KEY),
      kv.del(DEAL_COOLDOWN_KEY),
      kv.del(REBUYS_KEY),
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
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🃏 Min bet is ${MIN_BET} chip${MIN_BET > 1 ? 's' : ''}. !deal <amount>`;

  const overMaxNote = betAmount > MAX_BET ? `Max bet ${MAX_BET} chips — playing for ${bet}. ` : '';

  const now = Date.now();
  const lastAt = parseKvInt(await kv.hget<number | string>(DEAL_COOLDOWN_KEY, user));
  if (lastAt > 0 && now - lastAt < DEAL_COOLDOWN_MS) {
    const wait = Math.ceil((DEAL_COOLDOWN_MS - (now - lastAt)) / 1000);
    return `🃏 Wait ${wait}s before starting another hand.`;
  }

  const existing = await getActiveGame(username);
  if (existing) {
    const { value } = handValue(existing.playerHand);
    return `🃏 You're already in a hand (${existing.playerHand.map(cardDisplay).join(' ')} = ${value}). !hit or !stand`;
  }

  const { ok, balance } = await deductChips(user, bet);
  if (!ok) {
    return `🃏 Not enough chips. You have ${balance}. Use !chips to check balance.`;
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
      return `🃏 ${overMaxNote}Push! Both have 21. ${bet} chips returned.`;
    }
    const win = Math.floor(bet * 1.5);
    await Promise.all([
      addChips(user, bet + win),
      kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) }),
    ]);
    return `🃏 ${overMaxNote}Blackjack! You win ${win} chips! (bet returned + ${win} profit)`;
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
  return `🃏 ${overMaxNote}Your hand: ${playerHand.map(cardDisplay).join(' ')} (${playerVal.value}) | Dealer: ${dealerVis} | Bet: ${bet} — !hit or !stand${extras}`;
}

/** Double - double bet, take one card, stand. Only when 2 cards and not split. */
export async function double(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;
  if (game.split) return `🃏 Can't !double on split hands. Use !hit or !stand.`;
  if (game.playerHand.length !== 2) return `🃏 !double only on first 2 cards. Use !hit or !stand.`;

  const extraBet = game.bet;
  const { ok, balance } = await deductChips(user, extraBet);
  if (!ok) {
    return `🃏 Not enough chips to double (need ${extraBet} more). You have ${balance}.`;
  }

  const card = game.deck.pop()!;
  game.playerHand.push(card);
  const { value } = handValue(game.playerHand);

  if (value > 21) {
    await kv.del(gameKey(user));
    return `🃏 Double bust! Drew ${cardDisplay(card)} — ${game.playerHand.map(cardDisplay).join(' ')} = ${value}. Lost ${game.bet * 2} chips.`;
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
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;
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
  return `🃏 Split! Hand 1: ${game.playerHand.map(cardDisplay).join(' ')} (${v1}) — !hit or !stand (Hand 2: ${game.playerHand2!.map(cardDisplay).join(' ')} waits)`;
}

/** Hit - draw a card. */
export async function hit(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;

  const isHand1 = !game.split || !game.hand1Done;
  const hand = isHand1 ? game.playerHand : game.playerHand2!;
  const bet = isHand1 ? game.bet : game.bet2!;

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
          return `🃏 Hand 1 bust! Hand 2: ${game.playerHand2!.map(cardDisplay).join(' ')} (${v2}) also bust. Lost ${game.bet + game.bet2!} chips.`;
        }
        return `🃏 Hand 1 bust! Hand 2: ${game.playerHand2!.map(cardDisplay).join(' ')} (${v2}) — !hit or !stand`;
      } else {
        await kv.del(gameKey(user));
        return `🃏 Hand 2 bust! ${game.playerHand2!.map(cardDisplay).join(' ')} = ${value}. Lost ${game.bet + game.bet2!} chips.`;
      }
    }
    await kv.del(gameKey(user));
    return `🃏 Bust! You got ${cardDisplay(card)} — ${game.playerHand.map(cardDisplay).join(' ')} = ${value}. Lost ${game.bet} chips.`;
  }

  game.createdAt = Date.now();
  await kv.set(gameKey(user), game);
  const handLabel = game.split ? (isHand1 ? 'Hand 1' : 'Hand 2') : 'Your hand';
  return `🃏 Drew ${cardDisplay(card)}. ${handLabel}: ${hand.map(cardDisplay).join(' ')} (${value}) — !hit or !stand`;
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
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;

  if (game.split && !game.hand1Done) {
    game.hand1Done = true;
    game.createdAt = Date.now();
    await kv.set(gameKey(user), game);
    const v2 = handValue(game.playerHand2!).value;
    return `🃏 Hand 1 stood. Hand 2: ${game.playerHand2!.map(cardDisplay).join(' ')} (${v2}) — !hit or !stand`;
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
    if (totalWin > 0) await addChips(user, totalWin);
    await kv.del(gameKey(user));
    return `🃏 Dealer: ${dealerHand.map(cardDisplay).join(' ')} (${dealerVal}) | H1: ${r1.msg} | H2: ${r2.msg} | Net: ${totalWin - totalBet >= 0 ? '+' : ''}${totalWin - totalBet} chips`;
  }

  const playerVal = handValue(game.playerHand).value;
  const { win, msg } = resolveHand(dealerVal, playerVal, game.bet);
  if (win > 0) await addChips(user, win);

  await kv.del(gameKey(user));
  return `🃏 Dealer: ${dealerHand.map(cardDisplay).join(' ')} (${dealerVal}) | ${msg}`;
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

/** Coinflip: 50/50, 2x on win. !coinflip <amount> or !flip <amount> */
export async function playCoinflip(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🎲 Min bet ${MIN_BET}. !coinflip <amount> or !flip <amount>`;

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎲 Wait ${wait}s before another game.`;

  const { ok, balance } = await deductChips(user, bet);
  if (!ok) return `🎲 Not enough chips. You have ${balance}.`;
  await setInstantCooldown(user);

  const win = Math.random() < 0.5;
  if (win) {
    await addChips(user, bet * 2);
    return `🎲 Coinflip: HEADS — You win! +${bet} chips (${bet * 2} total)`;
  }
  return `🎲 Coinflip: TAILS — Lost ${bet} chips.`;
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

/** Slots: 3 reels, match 3 = big win, match 2 = push. !slots <amount> or !spin <amount> */
export async function playSlots(username: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🎰 Min bet ${MIN_BET}. !slots <amount> or !spin <amount>`;

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎰 Wait ${wait}s before another spin.`;

  const { ok, balance } = await deductChips(user, bet);
  if (!ok) return `🎰 Not enough chips. You have ${balance}.`;
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
    await addChips(user, win);
    return `🎰 [ ${display} ] JACKPOT! ${mult}x — +${win} chips!`;
  }
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    const match = reels[0] === reels[1] ? reels[0] : reels[1];
    const mult = Math.max(1, Math.floor(SLOT_MULTIPLIERS[match] / 2));
    const win = bet * mult;
    await addChips(user, win);
    return `🎰 [ ${display} ] Two match! ${mult}x — +${win - bet} chips (${win} back)`;
  }
  return `🎰 [ ${display} ] No match — lost ${bet} chips.`;
}

const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Roulette: bet red/black (2x) or number 1-36 (36x). !roulette <red|black|1-36> <amount> */
export async function playRoulette(username: string, choice: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🎡 Min bet ${MIN_BET}. !roulette <red|black|number> <amount>`;

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

  const { ok, balance } = await deductChips(user, bet);
  if (!ok) return `🎡 Not enough chips. You have ${balance}.`;
  await setInstantCooldown(user);

  const spin = Math.floor(Math.random() * 37);
  const spinRed = ROULETTE_RED.has(spin);
  const spinBlack = spin >= 1 && spin <= 36 && !spinRed;
  const spinStr = spin === 0 ? '0 (green)' : `${spin} (${spinRed ? 'red' : spinBlack ? 'black' : 'green'})`;

  if (isRed) {
    if (spinRed) {
      await addChips(user, bet * 2);
      return `🎡 [ ${spinStr} ] Red wins! +${bet} chips (${bet * 2} total)`;
    }
    return `🎡 [ ${spinStr} ] Red lost — ${bet} chips gone.`;
  }
  if (isBlack) {
    if (spinBlack) {
      await addChips(user, bet * 2);
      return `🎡 [ ${spinStr} ] Black wins! +${bet} chips (${bet * 2} total)`;
    }
    return `🎡 [ ${spinStr} ] Black lost — ${bet} chips gone.`;
  }
  if (spin === numBet) {
    const win = bet * 36;
    await addChips(user, win);
    return `🎡 [ ${spinStr} ] NUMBER HIT! 36x — +${win} chips!`;
  }
  return `🎡 [ ${spinStr} ] Wrong number — lost ${bet} chips.`;
}

/** Dice: bet high (4-6) or low (1-3). 2x on win. !dice <high|low> <amount> */
export async function playDice(username: string, choice: string, betAmount: number): Promise<string> {
  const user = normalizeUser(username);
  const bet = Math.floor(Math.min(MAX_BET, Math.max(MIN_BET, betAmount)));
  if (bet < MIN_BET) return `🎲 Min bet ${MIN_BET}. !dice <high|low> <amount>`;

  const wait = await checkInstantCooldown(user);
  if (wait !== null) return `🎲 Wait ${wait}s before another roll.`;

  const choiceLower = choice.trim().toLowerCase();
  const isHigh = choiceLower === 'high' || choiceLower === 'h';
  const isLow = choiceLower === 'low' || choiceLower === 'l';
  if (!isHigh && !isLow) return `🎲 Bet high (4-6) or low (1-3). !dice high 10`;

  const { ok, balance } = await deductChips(user, bet);
  if (!ok) return `🎲 Not enough chips. You have ${balance}.`;
  await setInstantCooldown(user);

  const roll = Math.floor(Math.random() * 6) + 1;
  const won = (isHigh && roll >= 4) || (isLow && roll <= 3);
  if (won) {
    await addChips(user, bet * 2);
    return `🎲 Rolled ${roll} (${isHigh ? 'high' : 'low'}) — You win! +${bet} chips (${bet * 2} total)`;
  }
  return `🎲 Rolled ${roll} (${roll >= 4 ? 'high' : 'low'}) — Lost ${bet} chips.`;
}
