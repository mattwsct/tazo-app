/**
 * Kick chat command handlers: !ping, !heartrate / !hr, wellness commands, blackjack
 */

import { getHeartrateStats } from '@/utils/stats-storage';
import { getUserPoints, getLeaderboardTop } from '@/utils/leaderboard-storage';
import {
  getWellnessStepsResponse,
  getWellnessDistanceResponse,
  getWellnessStandResponse,
  getWellnessCaloriesResponse,
  getWellnessHandwashingResponse,
  getWellnessFlightsResponse,
  getWellnessWeightResponse,
  getWellnessSummaryResponse,
  getWellnessHeartRateResponse,
} from '@/utils/wellness-chat';
import { getLocationData } from '@/utils/location-cache';
import { formatUvResponse, formatAqiResponse } from '@/utils/weather-chat';
import { getActiveGame, deal as blackjackDeal, hit as blackjackHit, stand as blackjackStand, double as blackjackDouble, split as blackjackSplit, getChips, getGamblingLeaderboardTop, refillChips, isGamblingEnabled } from '@/utils/blackjack-storage';

export const KICK_CHAT_COMMANDS = [
  'ping',
  'points',
  'leaderboard',
  'heartrate',
  'hr',
  'steps',
  'distance',
  'stand',
  'calories',
  'handwashing',
  'flights',
  'weight',
  'wellness',
  'uv',
  'aqi',
  'deal',
  'bj',
  'hit',
  'double',
  'split',
  'refill',
  'chips',
  'gambleboard',
  'chiptop',
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
  if (cmd === 'points' || cmd === 'pts') return { cmd: 'points' };
  if (cmd === 'leaderboard' || cmd === 'lb' || cmd === 'top') return { cmd: 'leaderboard' };
  if (cmd === 'heartrate' || cmd === 'hr') return { cmd: 'heartrate' };
  if (cmd === 'steps') return { cmd: 'steps' };
  if (cmd === 'distance' || cmd === 'dist') return { cmd: 'distance' };
  if (cmd === 'stand') return { cmd: 'stand' };
  if (cmd === 'calories' || cmd === 'cal') return { cmd: 'calories' };
  if (cmd === 'handwashing' || cmd === 'handwash') return { cmd: 'handwashing' };
  if (cmd === 'flights' || cmd === 'stairs') return { cmd: 'flights' };
  if (cmd === 'weight' || cmd === 'wt') return { cmd: 'weight' };
  if (cmd === 'wellness') return { cmd: 'wellness' };
  if (cmd === 'uv') return { cmd: 'uv' };
  if (cmd === 'aqi') return { cmd: 'aqi' };
  if (cmd === 'deal' || cmd === 'bj') return { cmd: cmd as 'deal' | 'bj', arg };
  if (cmd === 'hit') return { cmd: 'hit' };
  if (cmd === 'double' || cmd === 'dd') return { cmd: 'double' };
  if (cmd === 'split') return { cmd: 'split' };
  if (cmd === 'refill' || cmd === 'rebuy' || cmd === 'rebuys') return { cmd: 'refill' };
  if (cmd === 'chips') return { cmd: 'chips' };
  if (cmd === 'gambleboard' || cmd === 'chiptop' || cmd === 'gambletop') return { cmd: 'gambleboard' };
  return null;
}

export async function handleKickChatCommand(
  parsed: { cmd: KickChatCommand; arg?: string },
  senderUsername?: string
): Promise<string | null> {
  const { cmd, arg } = parsed;
  const user = senderUsername?.trim() ?? '';

  if (cmd === 'ping') return '🏓 Pong!';
  if (cmd === 'points') {
    if (!user) return null;
    const pts = await getUserPoints(user);
    return `📊 You have ${pts} points this stream. Chat, vote in polls, sub, gift, or tip to earn more!`;
  }
  if (cmd === 'leaderboard') {
    const top = await getLeaderboardTop(5);
    if (top.length === 0) return '📊 No points yet this stream. Chat, vote in polls, sub, gift, or tip to earn!';
    const lines = top.map((u, i) => `#${i + 1} ${u.username}: ${u.points} pts`).join(' | ');
    return `📊 Top: ${lines}`;
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
    return getWellnessStandResponse();
  }
  if (cmd === 'calories') return getWellnessCaloriesResponse();
  if (cmd === 'handwashing') return getWellnessHandwashingResponse();
  if (cmd === 'flights') return getWellnessFlightsResponse();
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

  // Blackjack (all require gambling enabled)
  const gamblingOn = await isGamblingEnabled();
  if (!gamblingOn && ['refill', 'chips', 'gambleboard', 'deal', 'bj', 'hit', 'double', 'split'].includes(cmd)) {
    return '🃏 Gambling is disabled for this stream.';
  }
  if (cmd === 'refill') {
    if (!user) return null;
    return refillChips(user);
  }
  if (cmd === 'chips') {
    if (!user) return null;
    const chips = await getChips(user);
    return `🃏 You have ${chips} chips (resets each stream). Chat to earn 10 per 10 min. !deal <amount> to play. At 0? !refill for a rebuy (1 per stream).`;
  }
  if (cmd === 'gambleboard') {
    const top = await getGamblingLeaderboardTop(5);
    if (top.length === 0) return '🃏 No chips yet this stream. !deal <amount> to play blackjack — everyone starts with 100 chips.';
    const lines = top.map((u, i) => `#${i + 1} ${u.username}: ${u.chips}`).join(' | ');
    return `🃏 Top chips (resets each stream): ${lines}`;
  }
  if (cmd === 'deal' || cmd === 'bj') {
    if (!user) return null;
    const bet = parseInt(arg ?? '1', 10);
    if (isNaN(bet) || bet < 1) return '🃏 Usage: !deal <amount> or !bj <amount> — e.g. !deal 5';
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
  return null;
}
