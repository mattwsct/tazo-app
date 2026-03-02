/**
 * !addtazos chat command: broadcaster and mods can add tazos to any user.
 * Usage: !addtazos user 50 or !addtazos 50 user
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { addTazosAsAdmin } from '@/utils/gambling-storage';


export interface HandleAddTazosResult {
  handled: boolean;
  reply?: string;
}

/**
 * Handle !addtazos <user> <amount> or !addtazos <amount> <user>. Broadcaster and mods only.
 */
export async function handleAddTazosCommand(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleAddTazosResult> {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!addtazos') && !trimmed.toLowerCase().startsWith('!addchips')) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(payload.sender, senderUsername, broadcasterSlug)) {
    return { handled: true, reply: '🃏 Only broadcaster and mods can use !addtazos.' };
  }

  const match = trimmed.match(/^!add(?:tazos|chips)\s+(.+)$/i);
  const argsStr = match?.[1]?.trim() ?? '';
  const parts = argsStr.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { handled: true, reply: '🃏 Usage: !addtazos user 50 or !addtazos 50 user' };
  }

  const num0 = parseInt(parts[0], 10);
  const num1 = parseInt(parts[1], 10);
  const isFirstNum = !isNaN(num0) && num0 >= 1;
  const isSecondNum = !isNaN(num1) && num1 >= 1;

  let username: string;
  let amount: number;
  if (isFirstNum && !isSecondNum) {
    amount = num0;
    username = parts[1];
  } else if (!isFirstNum && isSecondNum) {
    username = parts[0];
    amount = num1;
  } else if (isFirstNum && isSecondNum) {
    amount = num0;
    username = parts[1];
  } else {
    return { handled: true, reply: '🃏 Usage: !addtazos user 50 or !addtazos 50 user' };
  }

  const added = await addTazosAsAdmin(username, amount);
  if (added === 0) {
    return { handled: true, reply: '🃏 Invalid amount (must be ≥ 1).' };
  }
  return { handled: true, reply: `🃏 +${added} tazos to ${username}.` };
}
