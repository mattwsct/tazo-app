/**
 * Blackjack game: gambling chips (separate from leaderboard points), per-user game state.
 * Commands: !deal <amount>, !hit, !stand, !double (2 cards), !split (pairs). Chips and gambling leaderboard reset each stream.
 * New players start with 100 chips.
 */

import { kv } from '@vercel/kv';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';

const VIEW_CHIPS_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const VIEW_CHIPS_PER_INTERVAL = 10;

const CHIPS_BALANCE_KEY = 'blackjack_chips';
const GAMBLING_LEADERBOARD_KEY = 'blackjack_leaderboard';
const DEAL_COOLDOWN_KEY = 'blackjack_deal_last_at';
const REBUYS_KEY = 'blackjack_rebuys';
const VIEW_CHIPS_LAST_AT_KEY = 'blackjack_view_chips_last_at';
const ACTIVE_GAME_KEY_PREFIX = 'blackjack_game:';
const GAME_TIMEOUT_MS = 90_000; // Auto-stand after 90s
const DEAL_COOLDOWN_MS = 15_000; // Min 15s between starting new hands
const STARTING_CHIPS = 100;
const REBUY_CHIPS = 50; // Chips given when !refill at 0 (once per stream)
const REBUYS_PER_STREAM = 1;
const MIN_BET = 5;
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

/** Award chips for watch time (chat as heartbeat). 10 chips per 10 min, max 10 per chat (no backpay). */
export async function addViewTimeChips(username: string): Promise<number> {
  const user = normalizeUser(username);
  if (!(await isGamblingEnabled())) return 0;
  const excluded = await getLeaderboardExclusions();
  if (excluded.has(user)) return 0;

  try {
    const now = Date.now();
    const lastRaw = await kv.hget<number | string>(VIEW_CHIPS_LAST_AT_KEY, user);
    const lastAt = typeof lastRaw === 'number' ? lastRaw : (typeof lastRaw === 'string' ? parseInt(lastRaw, 10) : 0);
    const elapsed = lastAt > 0 ? now - lastAt : VIEW_CHIPS_INTERVAL_MS;
    const intervals = Math.floor(elapsed / VIEW_CHIPS_INTERVAL_MS);
    if (intervals < 1) return 0;

    // Cap at 1 interval per chat so you can't save up 2 hours and claim 120 chips
    const chipsToAdd = Math.min(intervals, 1) * VIEW_CHIPS_PER_INTERVAL;
    const bal = await getChips(user);
    const newBal = bal + chipsToAdd;
    await Promise.all([
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(newBal) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: newBal, member: user }),
      kv.hset(VIEW_CHIPS_LAST_AT_KEY, { [user]: String(now) }),
    ]);
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
    const usedRaw = await kv.hget<number | string>(REBUYS_KEY, user);
    const used = typeof usedRaw === 'number' ? usedRaw : (typeof usedRaw === 'string' ? parseInt(usedRaw, 10) : 0);
    if (used >= REBUYS_PER_STREAM) {
      return `🃏 You've already used your ${REBUYS_PER_STREAM} rebu${REBUYS_PER_STREAM === 1 ? 'y' : 'ys'} this stream. Chips reset when the stream starts.`;
    }
    await Promise.all([
      kv.hset(CHIPS_BALANCE_KEY, { [user]: String(REBUY_CHIPS) }),
      kv.zadd(GAMBLING_LEADERBOARD_KEY, { score: REBUY_CHIPS, member: user }),
      kv.hset(REBUYS_KEY, { [user]: String(used + 1) }),
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
      return `🃏 Push! Both have 21. ${bet} chips returned.`;
    }
    const win = Math.floor(bet * 1.5);
    await Promise.all([
      addChips(user, bet + win),
      kv.hset(DEAL_COOLDOWN_KEY, { [user]: String(now) }),
    ]);
    return `🃏 Blackjack! You win ${win} chips! (bet returned + ${win} profit)`;
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
  return `🃏 Your hand: ${playerHand.map(cardDisplay).join(' ')} (${playerVal.value}) | Dealer: ${dealerVis} | Bet: ${bet} — !hit or !stand${extras}`;
}

/** Double - double bet, take one card, stand. Only when 2 cards and not split. */
export async function double(username: string): Promise<string> {
  const user = normalizeUser(username);
  const game = await getActiveGame(username);
  if (!game) return `🃏 No active hand. Use !deal <amount> to play.`;
  if (game.split) return `🃏 Can't !double on split hands. Use !hit or !stand.`;
  if (game.playerHand.length !== 2) return `🃏 !double only on first 2 cards. Use !hit or !stand.`;

  const extraBet = game.bet;
  const hasChips = await deductChips(user, extraBet);
  if (!hasChips) {
    const chips = await getChips(user);
    return `🃏 Not enough chips to double (need ${extraBet} more). You have ${chips}.`;
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
  const hasChips = await deductChips(user, extraBet);
  if (!hasChips) {
    const chips = await getChips(user);
    return `🃏 Not enough chips to split (need ${extraBet} more). You have ${chips}.`;
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
