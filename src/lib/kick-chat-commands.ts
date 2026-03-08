/**
 * Kick chat command handlers: !ping, !heartrate / !hr, wellness commands, blackjack
 */

import { getHeartrateStats, getStreamStartedAt, getStreamEndedAt } from '@/utils/stats-storage';
import {
  getWellnessStepsResponse,
  getWellnessDistanceResponse,
  getWellnessHeightResponse,
  getWellnessWeightResponse,
  getWellnessSummaryResponse,
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
  getCredits,
  getCreditsIfExists,
  isGamblingEnabled,
  isSettingEnabled,
} from '@/utils/gambling-storage';
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
  'up',
  'downtime',
  'down',
  'followers',
  'leaderboard',
  'heartrate',
  'hr',
  'steps',
  'distance',
  'stand',
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
  'credits',
  'convert',
  'cv',
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
  if (cmd === 'uptime' || cmd === 'up') return { cmd: 'uptime' };
  if (cmd === 'downtime' || cmd === 'down') return { cmd: 'downtime' };
  if (cmd === 'followers') return { cmd: 'followers' };
  if (cmd === 'leaderboard' || cmd === 'lb' || cmd === 'top') return { cmd: 'leaderboard', arg: parts.slice(1).join(' ') };
  if (cmd === 'heartrate' || cmd === 'hr') return { cmd: 'heartrate' };
  if (cmd === 'steps') return { cmd: 'steps' };
  if (cmd === 'distance' || cmd === 'dist') return { cmd: 'distance' };
  if (cmd === 'stand') return { cmd: 'stand' };
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
  if (cmd === 'credits') return { cmd: 'credits', arg };
  if (cmd === 'convert' || cmd === 'cv') return { cmd: 'convert', arg: parts.slice(1).join(' ') };
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
    const [startedAt, endedAt] = await Promise.all([getStreamStartedAt(), getStreamEndedAt()]);
    if (!startedAt) return '⏱️ No stream session. Uptime resets when you go live.';
    const endTs = endedAt ?? Date.now();
    const ms = endTs - startedAt;
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h % 24 > 0) parts.push(`${h % 24}h`);
    parts.push(`${m % 60}m`);
    if (endedAt != null) {
      const sinceEnd = Date.now() - endedAt;
      const sm = Math.floor(sinceEnd / 60000);
      const sh = Math.floor(sm / 60);
      const sd = Math.floor(sh / 24);
      const sinceParts: string[] = [];
      if (sd > 0) sinceParts.push(`${sd}d`);
      if (sh % 24 > 0) sinceParts.push(`${sh % 24}h`);
      sinceParts.push(`${sm % 60}m`);
      return `⏱️ Live for ${parts.join(' ')} · Stream ended ${sinceParts.join(' ')} ago`;
    }
    return `⏱️ Live for ${parts.join(' ')}`;
  }
  if (cmd === 'downtime') {
    const endedAt = await getStreamEndedAt();
    if (!endedAt) return '⏱️ Stream has not ended yet. Use !uptime for live duration.';
    const sinceEnd = Date.now() - endedAt;
    const sec = Math.floor(sinceEnd / 1000);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h % 24 > 0) parts.push(`${h % 24}h`);
    parts.push(`${m % 60}m`);
    return `⏱️ Time since stream ended: ${parts.join(' ')}`;
  }
  if (cmd === 'leaderboard') {
    const gamblingOn = await isGamblingEnabled();
    if (!gamblingOn) return null;
    return 'No leaderboards. Use !credits to check your balance.';
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
    return '💓 No heart rate data this stream yet. (Pulsoid on overlay)';
  }
  if (cmd === 'steps') return getWellnessStepsResponse();
  if (cmd === 'distance') return getWellnessDistanceResponse();
  if (cmd === 'stand') {
    const bjGame = await getActiveGame(user);
    if (bjGame) return blackjackStand(user);
    const standBal = await getCredits(user);
    return `🃏 No active hand. !deal <amount> or !bj <amount> to play. (${standBal} Credits)`;
  }
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
    if (!(await isSettingEnabled('convertEnabled'))) return null;
    const parsed = parseConvertArgs(arg ?? '');
    if (parsed.type === 'unit') return convertUnit(parsed.amount, parsed.unit);
    if (parsed.type === 'currency') return handleConvertCurrency(parsed.amount, parsed.from, parsed.to);
    if (parsed.type === 'bare_number') return handleConvertBareNumber(parsed.amount);
    return handleConvertDefault();
  }
  if (cmd === 'math') {
    if (!(await isSettingEnabled('mathEnabled'))) return null;
    const expr = (arg ?? '').trim();
    if (!expr) return '🔢 Usage: !math <expression> — e.g. !math 5 x 29, !math (10 + 5) * 3';
    const result = evaluateMath(expr);
    if (result === null) return '🔢 Invalid expression. Use +, -, *, /, ^, () — e.g. !math 5 x 29';
    const formatted = Number.isInteger(result) ? result.toLocaleString() : parseFloat(result.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 });
    return `🔢 ${expr.replace(/\*/g, '×').replace(/\//g, '÷')} = ${formatted}`;
  }
  // Credits and blackjack (require gambling enabled)
  const gamblingCmds = ['credits', 'deal', 'bj', 'hit', 'double', 'split'];
  const gamblingOn = await isGamblingEnabled();
  if (!gamblingOn && gamblingCmds.includes(cmd)) {
    return 'Credits and blackjack are disabled.';
  }
  if (cmd === 'credits') {
    if (!user) return null;
    const targetUser = (arg ?? '').trim() || user;
    const isSelf = targetUser.toLowerCase() === user.toLowerCase();
    if (isSelf) {
      const bal = await getCredits(user);
      return `🃏 ${bal} Credits. !bj <amount> to play blackjack.`;
    }
    const bal = await getCreditsIfExists(targetUser);
    if (bal === null) return `That user has no Credits yet.`;
    return `🃏 ${targetUser}: ${bal} Credits`;
  }
  if (cmd === 'deal' || cmd === 'bj' || cmd === 'hit' || cmd === 'double' || cmd === 'split') {
    if (!(await isSettingEnabled('blackjackEnabled'))) return 'Blackjack is disabled.';
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
  return null;
}
