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
  getSubsResponse,
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
} from '@/utils/blackjack-storage';

export const KICK_CHAT_COMMANDS = [
  'ping',
  'uptime',
  'followers',
  'subs',
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
  'coinflip',
  'flip',
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
  if (cmd === 'subs' || cmd === 'subscribers') return { cmd: 'subs' };
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
  if (cmd === 'coinflip' || cmd === 'flip') return { cmd: 'coinflip', arg: arg ?? parts.slice(1).join(' ') };
  if (cmd === 'slots' || cmd === 'spin') return { cmd: 'slots', arg: arg ?? parts.slice(1).join(' ') };
  if (cmd === 'roulette') return { cmd: 'roulette', arg: parts.slice(1).join(' ') };
  if (cmd === 'dice') return { cmd: 'dice', arg: parts.slice(1).join(' ') };
  if (cmd === 'crash') return { cmd: 'crash', arg: parts.slice(1).join(' ') };
  if (cmd === 'war') return { cmd: 'war', arg };
  if (cmd === 'duel') return { cmd: 'duel', arg: parts.slice(1).join(' ') };
  if (cmd === 'accept') return { cmd: 'accept' };
  if (cmd === 'gamba' || cmd === 'gamble') return { cmd: 'gamble', arg: arg ?? parts.slice(1).join(' ') };
  if (cmd === 'games') return { cmd: 'games' };
  return null;
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
  if (cmd === 'subs') return getSubsResponse();

  // Gambling (all require gambling enabled)
  const gamblingCmds = ['chips', 'deal', 'bj', 'hit', 'double', 'split', 'coinflip', 'flip', 'slots', 'spin', 'roulette', 'dice', 'crash', 'war', 'duel', 'accept', 'gamba', 'gamble', 'games'];
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
    const betRaw = parseInt(arg ?? '', 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return blackjackDeal(user, bet);
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
  if (cmd === 'coinflip' || cmd === 'flip') {
    if (!user) return null;
    const betRaw = parseInt((arg ?? '').trim(), 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return playCoinflip(user, bet);
  }
  if (cmd === 'slots' || cmd === 'spin') {
    if (!user) return null;
    const betRaw = parseInt((arg ?? '').trim(), 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return playSlots(user, bet);
  }
  if (cmd === 'roulette') {
    if (!user) return null;
    const args = (arg ?? '').trim().split(/\s+/).filter(Boolean);
    const choice = args[0];
    if (!choice) return '🎡 Usage: !roulette <red|black|number> <amount> — e.g. !roulette red 10 or !roulette 27 10';
    const isColorBet = ['red', 'black'].includes(choice.toLowerCase());
    const isNumberBet = !isColorBet && !isNaN(parseInt(choice, 10));
    const num = parseInt(choice, 10);
    const validNumber = isNumberBet && num >= 1 && num <= 36;
    const amountArg = args.length >= 2 ? args[1] : null;
    const betRaw = amountArg != null ? parseInt(amountArg, 10) : 5;
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    const actualChoice = validNumber ? String(num) : choice;
    return playRoulette(user, actualChoice, bet);
  }
  if (cmd === 'dice') {
    if (!user) return null;
    const args = (arg ?? '').trim().split(/\s+/).filter(Boolean);
    const choice = args[0]?.toLowerCase();
    if (!choice || !['high', 'h', 'low', 'l'].includes(choice)) return '🎲 Usage: !dice <high|low> [amount] — default 5';
    const betRaw = args.length >= 2 ? parseInt(args[1], 10) : 5;
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return playDice(user, choice, bet);
  }
  if (cmd === 'crash') {
    if (!user) return null;
    const args = (arg ?? '').trim().split(/\s+/).filter(Boolean);
    if (!args.length) return '💥 Usage: !crash <amount> [target multiplier] — e.g. !crash 50 2.0 (cash out before it crashes!)';
    const betRaw = parseInt(args[0] ?? '', 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    const multRaw = args.length >= 2 ? parseFloat(args[1]) : undefined;
    const mult = multRaw && !isNaN(multRaw) && multRaw >= 1.1 ? multRaw : undefined;
    return playCrash(user, bet, mult);
  }
  if (cmd === 'war') {
    if (!user) return null;
    const betRaw = parseInt((arg ?? '').trim(), 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return playWar(user, bet);
  }
  if (cmd === 'duel') {
    if (!user) return null;
    const args = (arg ?? '').trim().split(/\s+/).filter(Boolean);
    let target = args[0] ?? '';
    if (target.startsWith('@')) target = target.slice(1);
    if (!target) return '⚔️ Usage: !duel @user <amount>';
    const betRaw = args.length >= 2 ? parseInt(args[1], 10) : 5;
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return challengeDuel(user, target, bet);
  }
  if (cmd === 'accept') {
    if (!user) return null;
    return acceptDuel(user);
  }
  if (cmd === 'gamba' || cmd === 'gamble') {
    if (!user) return null;
    const betRaw = parseInt((arg ?? '').trim(), 10);
    const bet = isNaN(betRaw) || betRaw < 1 ? 5 : betRaw;
    return playCoinflip(user, bet);
  }
  if (cmd === 'games') {
    return '🎲 !gamble [amt] | !deal [amt] | !slots [amt] | !coinflip [amt] | !dice high/low [amt] | !roulette red/black/number [amt] | !crash [amt] | !war [amt] | !duel @user [amt]. !chips to check balance.';
  }
  return null;
}
