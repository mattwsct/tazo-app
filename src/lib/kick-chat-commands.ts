/**
 * Kick chat command handlers: !ping, !heartrate / !hr, wellness commands
 */

import { getHeartrateStats } from '@/utils/stats-storage';
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

export const KICK_CHAT_COMMANDS = [
  'ping',
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
] as const;
export type KickChatCommand = (typeof KICK_CHAT_COMMANDS)[number];

export function parseKickChatMessage(content: string): { cmd: KickChatCommand } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return null;
  const cmd = trimmed.slice(1).trim().split(/\s/)[0]?.toLowerCase();
  if (cmd === 'ping') return { cmd: 'ping' };
  if (cmd === 'heartrate' || cmd === 'hr') return { cmd: 'heartrate' };
  if (cmd === 'steps') return { cmd: 'steps' };
  if (cmd === 'distance' || cmd === 'dist') return { cmd: 'distance' };
  if (cmd === 'stand') return { cmd: 'stand' };
  if (cmd === 'calories' || cmd === 'cal') return { cmd: 'calories' };
  if (cmd === 'handwashing' || cmd === 'handwash') return { cmd: 'handwashing' };
  if (cmd === 'flights' || cmd === 'stairs') return { cmd: 'flights' };
  if (cmd === 'weight' || cmd === 'wt') return { cmd: 'weight' };
  if (cmd === 'wellness') return { cmd: 'wellness' };
  return null;
}

export async function handleKickChatCommand(cmd: KickChatCommand): Promise<string | null> {
  if (cmd === 'ping') return '🏓 Pong!';
  if (cmd === 'heartrate') {
    const stats = await getHeartrateStats();
    if (stats.hasData) {
      const parts: string[] = [];
      if (stats.max) parts.push(`High: ${stats.max.bpm} bpm`);
      if (stats.min) parts.push(`Low: ${stats.min.bpm} bpm`);
      if (stats.current) {
        const curr = stats.current.age === 'current' ? `${stats.current.bpm} bpm (live)` : `${stats.current.bpm} bpm (${stats.current.age} ago)`;
        parts.push(`Current: ${curr}`);
      }
      return `💓 ${parts.join(' | ')}`;
    }
    const wellnessHr = await getWellnessHeartRateResponse();
    if (wellnessHr) return wellnessHr;
    return '💓 No heart rate data this stream yet.';
  }
  if (cmd === 'steps') return getWellnessStepsResponse();
  if (cmd === 'distance') return getWellnessDistanceResponse();
  if (cmd === 'stand') return getWellnessStandResponse();
  if (cmd === 'calories') return getWellnessCaloriesResponse();
  if (cmd === 'handwashing') return getWellnessHandwashingResponse();
  if (cmd === 'flights') return getWellnessFlightsResponse();
  if (cmd === 'weight') return getWellnessWeightResponse();
  if (cmd === 'wellness') return getWellnessSummaryResponse();
  return null;
}
