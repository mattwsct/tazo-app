/**
 * Kick chat command handlers: !ping, !heartrate / !hr, wellness commands, blackjack
 */

import { getHeartrateStats, getStreamStartedAt } from '@/utils/stats-storage';
import {
  getWellnessStepsResponse,
  getWellnessDistanceResponse,
  getWellnessCaloriesResponse,
  getWellnessFlightsResponse,
  getWellnessHeightResponse,
  getWellnessWeightResponse,
  getWellnessSummaryResponse,
  getWellnessHeartRateResponse,
} from '@/utils/wellness-chat';
import { getLocationData } from '@/utils/location-cache';
import { formatUvResponse, formatAqiResponse } from '@/utils/weather-chat';
import {
  getSpeedResponse,
  getAltitudeResponse,
  getForecastResponse,
  getMapResponse,
  getFollowersResponse,
} from '@/lib/chat-response-helpers';
import {
  getActiveGame,
  deal as blackjackDeal,
  hit as blackjackHit,
  stand as blackjackStand,
  double as blackjackDouble,
  split as blackjackSplit,
  getChips,
  getGamblingLeaderboardTop,
  isGamblingEnabled,
  playCoinflip,
  playSlots,
  playRoulette,
  playDice,
  playCrash,
  playWar,
  challengeDuel,
  acceptDuel,
  joinOrStartHeist,
  getHeistStatus,
  checkAndResolveExpiredHeist,
  joinRaffle,
  getRaffleStatus,
} from '@/utils/blackjack-storage';
import {
  parseConvertArgs,
  convertUnit,
  handleConvertCurrency,
  handleConvertBareNumber,
  handleConvertDefault,
} from '@/utils/convert-utils';

/**
 * Safe math expression evaluator — supports +, -, *, /, ^, %, parentheses.
 * Accepts 'x' as multiplication alias. No eval().
 */
function evaluateMath(expr: string): number | null {
  const tokens: string[] = [];
  const cleaned = expr.replace(/\s+/g, '').replace(/x/gi, '*').replace(/÷/g, '/');
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if ('+-*/^%()'.includes(ch)) {
      tokens.push(ch);
      i++;
    } else if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < cleaned.length && /[\d.]/.test(cleaned[i])) { num += cleaned[i]; i++; }
      tokens.push(num);
    } else {
      return null;
    }
  }
  if (tokens.length === 0) return null;

  let pos = 0;
  function peek(): string | undefined { return tokens[pos]; }
  function consume(): string { return tokens[pos++]; }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') left = right === 0 ? NaN : left / right;
      else left = right === 0 ? NaN : left % right;
    }
    return left;
  }
  function parsePower(): number {
    let base = parseUnary();
    if (peek() === '^') { consume(); base = Math.pow(base, parsePower()); }
    return base;
  }
  function parseUnary(): number {
    if (peek() === '-') { consume(); return -parseAtom(); }
    if (peek() === '+') { consume(); return parseAtom(); }
    return parseAtom();
  }
  function parseAtom(): number {
    if (peek() === '(') {
      consume();
      const val = parseExpr();
      if (peek() === ')') consume();
      return val;
    }
    const tok = consume();
    if (tok === undefined) return NaN;
    const n = parseFloat(tok);
    return isNaN(n) ? NaN : n;
  }

  try {
    const result = parseExpr();
    if (pos < tokens.length) return null;
    if (!isFinite(result)) return null;
    return result;
  } catch { return null; }
}

export const KICK_CHAT_COMMANDS = [
  'ping',
  'uptime',
  'followers',
  'leaderboard',
  'heartrate',
  'hr',
  'steps',
  'distance',
  'stand',
  'calories',
  'flights',
  'height',
  'length',
  'weight',
  'wellness',
  'uv',
  'aqi',
  'speed',
  'altitude',
  'elevation',
  'forecast',
  'map',
  'deal',
  'bj',
  'hit',
  'double',
  'split',
  'chips',
  'slots',
  'spin',
  'roulette',
  'dice',
  'crash',
  'war',
  'duel',
  'accept',
  'gamble',
  'gamba',
  'games',
  'heist',
  'join',
  'convert',
  'math',
] as const;
export type KickChatCommand = (typeof KICK_CHAT_COMMANDS)[number];

export function parseKickChatMessage(content: string): { cmd: KickChatCommand; arg?: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return null;
  const rest = trimmed.slice(1).trim();
  const parts = rest.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const arg = parts[1];
  if (cmd === 'ping') return { cmd: 'ping' };
  if (cmd === 'uptime') return { cmd: 'uptime' };
  if (cmd === 'followers') return { cmd: 'followers' };
  if (cmd === 'leaderboard' || cmd === 'lb' || cmd === 'top') return { cmd: 'leaderboard' };
  if (cmd === 'heartrate' || cmd === 'hr') return { cmd: 'heartrate' };
  if (cmd === 'steps') return { cmd: 'steps' };
  if (cmd === 'distance' || cmd === 'dist') return { cmd: 'distance' };
  if (cmd === 'stand') return { cmd: 'stand' };
  if (cmd === 'calories' || cmd === 'cal') return { cmd: 'calories' };
  if (cmd === 'flights') return { cmd: 'flights' };
  if (cmd === 'height') return { cmd: 'height' };
  if (cmd === 'length') return { cmd: 'length' };
  if (cmd === 'weight') return { cmd: 'weight' };
  if (cmd === 'wellness') return { cmd: 'wellness' };
  if (cmd === 'uv') return { cmd: 'uv' };
  if (cmd === 'aqi') return { cmd: 'aqi' };
  if (cmd === 'speed') return { cmd: 'speed' };
  if (cmd === 'altitude' || cmd === 'elevation') return { cmd: 'altitude' };
  if (cmd === 'forecast') return { cmd: 'forecast' };
  if (cmd === 'map') return { cmd: 'map' };
  if (cmd === 'deal' || cmd === 'bj') return { cmd: cmd as 'deal' | 'bj', arg };
  if (cmd === 'hit') return { cmd: 'hit' };
  if (cmd === 'double') return { cmd: 'double' };
  if (cmd === 'split') return { cmd: 'split' };
  if (cmd === 'chips') return { cmd: 'chips', arg };
  if (cmd === 'slots' || cmd === 'spin') return { cmd: 'slots', arg: arg ?? parts.slice(1).join(' ') };
  if (cmd === 'roulette') return { cmd: 'roulette', arg: parts.slice(1).join(' ') };
  if (cmd === 'dice') return { cmd: 'dice', arg: parts.slice(1).join(' ') };
  if (cmd === 'crash') return { cmd: 'crash', arg: parts.slice(1).join(' ') };
  if (cmd === 'war') return { cmd: 'war', arg };
  if (cmd === 'duel') return { cmd: 'duel', arg: parts.slice(1).join(' ') };
  if (cmd === 'accept') return { cmd: 'accept' };
  if (cmd === 'gamba' || cmd === 'gamble') return { cmd: 'gamble', arg: arg ?? parts.slice(1).join(' ') };
  if (cmd === 'games') return { cmd: 'games' };
  if (cmd === 'heist') return { cmd: 'heist', arg };
  if (cmd === 'join') return { cmd: 'join' };
  if (cmd === 'convert') return { cmd: 'convert', arg: parts.slice(1).join(' ') };
  if (cmd === 'math' || cmd === 'calc') return { cmd: 'math', arg: parts.slice(1).join(' ') };
  return null;
}

function parseBet(input: string | undefined, defaultBet = 5): number {
  const s = (input ?? '').trim().toLowerCase();
  if (['max', 'all', 'allin', 'all-in'].includes(s)) return Infinity;
  const raw = parseInt(s, 10);
  return !isNaN(raw) && raw >= 1 ? raw : defaultBet;
}

function splitArgs(arg: string | undefined): string[] {
  return (arg ?? '').trim().split(/\s+/).filter(Boolean);
}

export async function handleKickChatCommand(
  parsed: { cmd: KickChatCommand; arg?: string },
  senderUsername?: string
): Promise<string | null> {
  const { cmd, arg } = parsed;
  const user = senderUsername?.trim() ?? '';

  if (cmd === 'ping') return '🏓 Pong!';
  if (cmd === 'uptime') {
    const startedAt = await getStreamStartedAt();
    if (!startedAt) return '⏱️ No stream session. Uptime resets when you go live.';
    const ms = Date.now() - startedAt;
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h % 24 > 0) parts.push(`${h % 24}h`);
    parts.push(`${m % 60}m`);
    return `⏱️ Live for ${parts.join(' ')}`;
  }
  if (cmd === 'leaderboard') {
    const gamblingOn = await isGamblingEnabled();
    if (!gamblingOn) return '🃏 Gambling is disabled for this stream.';
    const top = await getGamblingLeaderboardTop(5);
    if (top.length === 0) return '🃏 No chips yet this stream. !deal <amount> to play blackjack — everyone starts with 100 chips.';
    const lines = top.map((u, i) => `#${i + 1} ${u.username}: ${u.chips}`).join(' | ');
    return `🃏 Top chips (resets each stream): ${lines}`;
  }
  if (cmd === 'heartrate') {
    const stats = await getHeartrateStats();
    if (stats.hasData) {
      const parts: string[] = [];
      if (stats.current) {
        const curr = stats.current.age === 'current' ? `${stats.current.bpm} bpm (live)` : `${stats.current.bpm} bpm (${stats.current.age} ago)`;
        parts.push(`Current: ${curr}`);
      }
      if (stats.min) parts.push(`Low: ${stats.min.bpm} bpm`);
      if (stats.max) parts.push(`High: ${stats.max.bpm} bpm`);
      return `💓 ${parts.join(' | ')}`;
    }
    const wellnessHr = await getWellnessHeartRateResponse();
    if (wellnessHr) return wellnessHr;
    return '💓 No heart rate data this stream yet.';
  }
  if (cmd === 'steps') return getWellnessStepsResponse();
  if (cmd === 'distance') return getWellnessDistanceResponse();
  if (cmd === 'stand') {
    const bjGame = await getActiveGame(user);
    if (bjGame) return blackjackStand(user);
    const standChips = await getChips(user);
    return `🃏 No active hand. !deal <amount> to play. You have ${standChips} chips.`;
  }
  if (cmd === 'calories') return getWellnessCaloriesResponse();
  if (cmd === 'flights') return getWellnessFlightsResponse();
  if (cmd === 'height') return getWellnessHeightResponse();
  if (cmd === 'length') return '📏 18 cm × 14 cm (7.1" × 5.5")';
  if (cmd === 'weight') return getWellnessWeightResponse();
  if (cmd === 'wellness') return getWellnessSummaryResponse();
  if (cmd === 'uv') {
    const data = await getLocationData();
    return formatUvResponse(data?.weather?.uvIndex);
  }
  if (cmd === 'aqi') {
    const data = await getLocationData();
    return formatAqiResponse(data?.weather?.aqi);
  }
  if (cmd === 'speed') return getSpeedResponse();
  if (cmd === 'altitude') return getAltitudeResponse();
  if (cmd === 'forecast') return getForecastResponse();
  if (cmd === 'map') return getMapResponse();
  if (cmd === 'followers') return getFollowersResponse();
  if (cmd === 'convert') {
    const parsed = parseConvertArgs(arg ?? '');
    if (parsed.type === 'unit') return convertUnit(parsed.amount, parsed.unit);
    if (parsed.type === 'currency') return handleConvertCurrency(parsed.amount, parsed.from, parsed.to);
    if (parsed.type === 'bare_number') return handleConvertBareNumber(parsed.amount);
    return handleConvertDefault();
  }
  if (cmd === 'math') {
    const expr = (arg ?? '').trim();
    if (!expr) return '🔢 Usage: !math <expression> — e.g. !math 5 x 29, !math (10 + 5) * 3';
    const result = evaluateMath(expr);
    if (result === null) return '🔢 Invalid expression. Use +, -, *, /, ^, () — e.g. !math 5 x 29';
    const formatted = Number.isInteger(result) ? result.toLocaleString() : parseFloat(result.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 });
    return `🔢 ${expr.replace(/\*/g, '×').replace(/\//g, '÷')} = ${formatted}`;
  }
  // Gambling (all require gambling enabled)
  const gamblingCmds = ['chips', 'deal', 'bj', 'hit', 'double', 'split', 'slots', 'spin', 'roulette', 'dice', 'crash', 'war', 'duel', 'accept', 'gamba', 'gamble', 'games', 'heist', 'join'];
  const gamblingOn = await isGamblingEnabled();
  if (!gamblingOn && gamblingCmds.includes(cmd)) {
    return '🃏 Gambling is disabled for this stream.';
  }
  if (cmd === 'chips') {
    if (!user) return null;
    const targetUser = (arg ?? '').trim() || user;
    const chips = await getChips(targetUser);
    if (targetUser.toLowerCase() === user.toLowerCase()) {
      return `🃏 You have ${chips} chips. !games for options. Redeem channel points for more chips.`;
    }
    return `🃏 ${targetUser} has ${chips} chips (resets each stream).`;
  }
  if (cmd === 'deal' || cmd === 'bj') {
    if (!user) return null;
    return blackjackDeal(user, parseBet(arg));
  }
  if (cmd === 'hit') {
    if (!user) return null;
    return blackjackHit(user);
  }
  if (cmd === 'double') {
    if (!user) return null;
    return blackjackDouble(user);
  }
  if (cmd === 'split') {
    if (!user) return null;
    return blackjackSplit(user);
  }
  if (cmd === 'slots' || cmd === 'spin') {
    if (!user) return null;
    return playSlots(user, parseBet(arg));
  }
  if (cmd === 'roulette') {
    if (!user) return null;
    const args = splitArgs(arg);
    const choice = args[0];
    if (!choice) return '🎡 Usage: !roulette <red|black|number> <amount> — e.g. !roulette red 10 or !roulette 27 10';
    const num = parseInt(choice, 10);
    const isColorBet = ['red', 'black'].includes(choice.toLowerCase());
    const validNumber = !isColorBet && !isNaN(num) && num >= 1 && num <= 36;
    return playRoulette(user, validNumber ? String(num) : choice, parseBet(args[1]));
  }
  if (cmd === 'dice') {
    if (!user) return null;
    const args = splitArgs(arg);
    const choice = args[0]?.toLowerCase();
    if (!choice || !['high', 'h', 'low', 'l'].includes(choice)) return '🎲 Usage: !dice <high|low> [amount] — default 5';
    return playDice(user, choice, parseBet(args[1]));
  }
  if (cmd === 'crash') {
    if (!user) return null;
    const args = splitArgs(arg);
    if (!args.length) return '💥 Usage: !crash <amount> [target multiplier] — e.g. !crash 50 2.0 (cash out before it crashes!)';
    const multRaw = args.length >= 2 ? parseFloat(args[1]) : undefined;
    return playCrash(user, parseBet(args[0]), multRaw && !isNaN(multRaw) && multRaw >= 1.1 ? multRaw : undefined);
  }
  if (cmd === 'war') {
    if (!user) return null;
    return playWar(user, parseBet(arg));
  }
  if (cmd === 'duel') {
    if (!user) return null;
    const args = splitArgs(arg);
    let target = args[0] ?? '';
    if (target.startsWith('@')) target = target.slice(1);
    if (!target) return '⚔️ Usage: !duel @user <amount>';
    return challengeDuel(user, target, parseBet(args[1]));
  }
  if (cmd === 'accept') {
    if (!user) return null;
    return acceptDuel(user);
  }
  if (cmd === 'gamba' || cmd === 'gamble') {
    if (!user) return null;
    return playCoinflip(user, parseBet(arg));
  }
  if (cmd === 'games') {
    return '🎲 Games: !gamble !deal !slots !dice !roulette !crash !war !duel !heist — Use max/all to go all-in. !chips for balance.';
  }
  if (cmd === 'heist') {
    if (!user) return null;
    const bet = parseBet(arg, 0);
    if (bet < 1) {
      const status = await getHeistStatus();
      if (status) return status;
      const expired = await checkAndResolveExpiredHeist();
      if (expired) return expired;
      return '🏦 Usage: !heist <amount> — Start or join a group heist. More robbers = better odds!';
    }
    return joinOrStartHeist(user, bet);
  }
  if (cmd === 'join') {
    if (!user) return null;
    return joinRaffle(user);
  }
  return null;
}
