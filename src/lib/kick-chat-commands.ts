/**
 * Kick chat command handlers. Only !ping for now — replies to the user's message.
 */

export const KICK_CHAT_COMMANDS = ['ping'] as const;
export type KickChatCommand = (typeof KICK_CHAT_COMMANDS)[number];

export function parseKickChatMessage(content: string): { cmd: KickChatCommand } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return null;
  const cmd = trimmed.slice(1).trim().split(/\s/)[0]?.toLowerCase();
  if (cmd !== 'ping') return null;
  return { cmd: 'ping' };
}

export async function handleKickChatCommand(cmd: KickChatCommand): Promise<string | null> {
  if (cmd === 'ping') return '🏓 Pong!';
  return null;
}
