/**
 * Kick chat command handlers: !ping, !heartrate / !hr
 */

import { getHeartrateStats } from '@/utils/stats-storage';

export const KICK_CHAT_COMMANDS = ['ping', 'heartrate', 'hr'] as const;
export type KickChatCommand = (typeof KICK_CHAT_COMMANDS)[number];

export function parseKickChatMessage(content: string): { cmd: KickChatCommand } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return null;
  const cmd = trimmed.slice(1).trim().split(/\s/)[0]?.toLowerCase();
  if (cmd === 'ping') return { cmd: 'ping' };
  if (cmd === 'heartrate' || cmd === 'hr') return { cmd: 'heartrate' };
  return null;
}

export async function handleKickChatCommand(cmd: KickChatCommand): Promise<string | null> {
  if (cmd === 'ping') return '🏓 Pong!';
  if (cmd === 'heartrate') {
    const stats = await getHeartrateStats();
    if (!stats.hasData) return '💓 No heart rate data this stream yet.';
    const parts: string[] = [];
    if (stats.max) parts.push(`High: ${stats.max.bpm} bpm`);
    if (stats.min) parts.push(`Low: ${stats.min.bpm} bpm`);
    if (stats.current) {
      const curr = stats.current.age === 'current' ? `${stats.current.bpm} bpm (live)` : `${stats.current.bpm} bpm (${stats.current.age} ago)`;
      parts.push(`Current: ${curr}`);
    }
    return `💓 ${parts.join(' | ')}`;
  }
  return null;
}
