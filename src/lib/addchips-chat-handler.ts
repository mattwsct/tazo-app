/**
 * !addchips chat command: broadcaster and mods can add chips to any user.
 * Usage: !addchips user 50 or !addchips 50 user
 */

import { kv } from '@vercel/kv';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { addChipsAsAdmin } from '@/utils/blackjack-storage';

function isModOrBroadcaster(
  sender: unknown,
  senderUsername: string,
  broadcasterSlug: string | null
): boolean {
  if (!sender || typeof sender !== 'object') return false;
  const s = sender as Record<string, unknown>;
  const identity = s.identity as Record<string, unknown> | undefined;
  const role = String(identity?.role ?? s.role ?? '').toLowerCase();
  const rolesArr = s.roles as string[] | undefined;
  const rolesLower = Array.isArray(rolesArr) ? rolesArr.map((r) => String(r).toLowerCase()) : [];
  if (role === 'moderator' || role === 'owner' || role === 'broadcaster') return true;
  if (rolesLower.includes('moderator') || rolesLower.includes('owner') || rolesLower.includes('broadcaster')) return true;
  if (s.is_moderator === true || s.moderator === true || s.isModerator === true) return true;
  const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
  if (senderUsername?.toLowerCase() === broadcasterLower) return true;
  return false;
}

export interface HandleAddChipsResult {
  handled: boolean;
  reply?: string;
}

/**
 * Handle !addchips <user> <amount> or !addchips <amount> <user> — add chips to a user. Broadcaster and mods only.
 */
export async function handleAddChipsCommand(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleAddChipsResult> {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!addchips')) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(payload.sender, senderUsername, broadcasterSlug)) {
    return { handled: true, reply: '🃏 Only broadcaster and mods can use !addchips.' };
  }

  const match = trimmed.match(/^!addchips\s+(.+)$/i);
  const argsStr = match?.[1]?.trim() ?? '';
  const parts = argsStr.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { handled: true, reply: '🃏 Usage: !addchips user 50 or !addchips 50 user' };
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
    return { handled: true, reply: '🃏 Usage: !addchips user 50 or !addchips 50 user' };
  }

  const added = await addChipsAsAdmin(username, amount);
  if (added === 0) {
    return { handled: true, reply: '🃏 Invalid amount (must be ≥ 1).' };
  }
  return { handled: true, reply: `🃏 Added ${added} chips to ${username}.` };
}
