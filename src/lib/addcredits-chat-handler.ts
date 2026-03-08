/**
 * !addcredits chat command: broadcaster and mods can add Credits to any user.
 * Usage: !addcredits user 50 or !addcredits 50 user
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { addCredits } from '@/utils/gambling-storage';

export interface HandleAddCreditsResult {
  handled: boolean;
  reply?: string;
}

/**
 * Handle !addcredits <user> <amount> or !addcredits <amount> <user>. Broadcaster and mods only.
 */
export async function handleAddCreditsCommand(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleAddCreditsResult> {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!addcredits')) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(payload.sender, senderUsername, broadcasterSlug)) {
    return { handled: true, reply: 'Only broadcaster and mods can use !addcredits.' };
  }

  const match = trimmed.match(/^!addcredits\s+(.+)$/i);
  const argsStr = match?.[1]?.trim() ?? '';
  const parts = argsStr.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { handled: true, reply: 'Usage: !addcredits user 50 or !addcredits 50 user' };
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
    return { handled: true, reply: 'Usage: !addcredits user 50 or !addcredits 50 user' };
  }

  await addCredits(username, amount, { skipExclusions: true });
  return { handled: true, reply: `+${amount} Credits to ${username}.` };
}
