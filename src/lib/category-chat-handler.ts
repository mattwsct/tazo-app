/**
 * !irl, !sleep, !chat, !software, !gym chat commands: change Kick stream category.
 * Broadcaster and mods only.
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import {
  KICK_BROADCASTER_SLUG_KEY,
  getValidAccessToken,
  searchKickCategory,
  updateChannelCategory,
} from '@/lib/kick-api';

const CATEGORY_COMMANDS: Record<string, string> = {
  irl: 'IRL',
  sleep: 'Just Sleeping',
  chat: 'Just Chatting',
  software: 'Software Development',
  gym: 'Fitness & Health',
};

const CATEGORY_ID_CACHE_KEY = 'kick_category_id_cache';
const CACHE_TTL_SEC = 86400; // 24h


async function getCachedCategoryId(accessToken: string, categoryName: string): Promise<number | null> {
  const cacheKey = `${CATEGORY_ID_CACHE_KEY}:${categoryName.toLowerCase()}`;
  const cached = await kv.get<number>(cacheKey);
  if (cached != null) return cached;

  const result = await searchKickCategory(accessToken, categoryName);
  if (!result) return null;

  await kv.set(cacheKey, result.id, { ex: CACHE_TTL_SEC });
  return result.id;
}

export interface HandleCategoryResult {
  handled: boolean;
  reply?: string;
}

export async function handleCategoryCommand(
  content: string,
  senderUsername: string,
  payload: Record<string, unknown>
): Promise<HandleCategoryResult> {
  const trimmed = content.trim().toLowerCase();
  if (!trimmed.startsWith('!')) return { handled: false };

  const cmd = trimmed.slice(1).split(/\s+/)[0];
  const categoryName = CATEGORY_COMMANDS[cmd];
  if (!categoryName) return { handled: false };

  const accessToken = await getValidAccessToken();
  if (!accessToken) return { handled: true, reply: 'Category change failed — not connected to Kick.' };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(payload.sender, senderUsername, broadcasterSlug)) {
    return { handled: true };
  }

  const categoryId = await getCachedCategoryId(accessToken, categoryName);
  if (categoryId == null) {
    return { handled: true, reply: `Could not find category "${categoryName}" on Kick.` };
  }

  const result = await updateChannelCategory(accessToken, categoryId);
  if (!result.ok) {
    return { handled: true, reply: `Failed to change category: ${result.error}` };
  }

  return { handled: true, reply: `Category changed to ${categoryName}` };
}

/** Set channel category to IRL (e.g. when stream ends). Fire-and-forget; logs on failure. */
export async function setChannelCategoryToIRL(): Promise<void> {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) return;
    const categoryId = await getCachedCategoryId(accessToken, CATEGORY_COMMANDS.irl);
    if (categoryId == null) return;
    const result = await updateChannelCategory(accessToken, categoryId);
    if (!result.ok && process.env.NODE_ENV === 'development') {
      console.warn('[category] Failed to set IRL on stream end:', result.error);
    }
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[category] setChannelCategoryToIRL error:', e);
    }
  }
}
