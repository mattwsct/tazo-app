/**
 * Kick.com API utilities for webhooks, OAuth, chat, and event subscriptions.
 * @see https://docs.kick.com
 */

import { createHash, randomBytes, createVerify, createPublicKey } from 'node:crypto';
import type { IncomingHttpHeaders } from 'http';
import { kv } from '@vercel/kv';

// --- Constants ---

export const KICK_API_BASE = 'https://api.kick.com';
export const KICK_TOKENS_KEY = 'kick_tokens';
export const KICK_OAUTH_BASE = 'https://id.kick.com';
export const KICK_STREAM_TITLE_SETTINGS_KEY = 'kick_stream_title_settings';
export const KICK_BROADCASTER_SLUG_KEY = 'kick_broadcaster_slug';

export const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

/** Scopes for full API access (chat, events, channel, rewards, moderation, kicks) */
export const KICK_SCOPES = [
  'chat:write',
  'events:subscribe',
  'channel:read',
  'channel:write',
  'channel:rewards:read',
  'channel:rewards:write',
  'kicks:read',
  'moderation:ban',
  'user:read',
].join(' ');

/** All event types we subscribe to. */
export const KICK_EVENT_SUBSCRIPTIONS = [
  { name: 'channel.followed', version: 1 },
  { name: 'channel.subscription.new', version: 1 },
  { name: 'channel.subscription.renewal', version: 1 },
  { name: 'channel.subscription.gifts', version: 1 },
  { name: 'kicks.gifted', version: 1 },
  { name: 'channel.reward.redemption.updated', version: 1 },
  { name: 'livestream.status.updated', version: 1 },
  { name: 'chat.message.sent', version: 1 },
] as const;

export type KickEventType = (typeof KICK_EVENT_SUBSCRIPTIONS)[number]['name'];

// --- Types ---

export interface KickTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

export interface StoredKickTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp ms
  scope?: string;
}

// --- PKCE ---

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

// --- Webhook signature verification ---

export function verifyKickWebhookSignature(
  rawBody: string,
  headers: IncomingHttpHeaders
): boolean {
  const signature = headers['kick-event-signature'] as string | undefined;
  const messageId = headers['kick-event-message-id'] as string | undefined;
  const timestamp = headers['kick-event-message-timestamp'] as string | undefined;

  if (!signature || !messageId || !timestamp) {
    return false;
  }

  try {
    const payload = `${messageId}.${timestamp}.${rawBody}`;
    const key = createPublicKey(KICK_PUBLIC_KEY);
    const verify = createVerify('RSA-SHA256');
    verify.update(payload);
    verify.end();
    return verify.verify(key, signature, 'base64');
  } catch {
    return false;
  }
}

// --- OAuth token exchange ---

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<KickTokens> {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('KICK_CLIENT_ID and KICK_CLIENT_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${KICK_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick token exchange failed: ${res.status} ${err}`);
  }

  return res.json();
}

export async function refreshKickTokens(refreshToken: string): Promise<KickTokens> {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('KICK_CLIENT_ID and KICK_CLIENT_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${KICK_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick token refresh failed: ${res.status} ${err}`);
  }

  return res.json();
}

// --- Token access (shared by webhooks, cron) ---

export async function getValidAccessToken(): Promise<string | null> {
  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) return null;

  const now = Date.now();
  const bufferMs = 60 * 1000;
  if (stored.expires_at - bufferMs > now) return stored.access_token;

  try {
    const tokens = await refreshKickTokens(stored.refresh_token);
    const expiresAt = now + tokens.expires_in * 1000;
    await kv.set(KICK_TOKENS_KEY, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
    });
    return tokens.access_token;
  } catch {
    return null;
  }
}

// --- Chat ---

export async function sendKickChatMessage(
  accessToken: string,
  content: string,
  opts?: { replyToMessageId?: string }
): Promise<{ is_sent: boolean; message_id?: string }> {
  const body: { content: string; type: string; reply_to_message_id?: string } = { content, type: 'bot' };
  if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;
  const res = await fetch(`${KICK_API_BASE}/public/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick chat send failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data ?? { is_sent: false };
}

// --- Event subscriptions ---

/**
 * Get broadcaster_user_id for the authenticated user.
 * GET /channels returns the authenticated broadcaster's channel (stream title, live status, etc).
 * Used for: webhook subscription setup (broadcaster_user_id), stream title UI, broadcast cron.
 */
async function getBroadcasterUserId(accessToken: string): Promise<number | null> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const channels = data.data ?? [];
  const channel = Array.isArray(channels) ? channels[0] : channels;
  const id = channel?.broadcaster_user_id ?? channel?.user_id;
  return typeof id === 'number' ? id : null;
}

export async function subscribeToKickEvents(accessToken: string): Promise<unknown[]> {
  const broadcasterUserId = await getBroadcasterUserId(accessToken);
  const body: { events: typeof KICK_EVENT_SUBSCRIPTIONS; method: 'webhook'; broadcaster_user_id?: number } = {
    events: KICK_EVENT_SUBSCRIPTIONS,
    method: 'webhook',
  };
  if (broadcasterUserId != null) {
    body.broadcaster_user_id = broadcasterUserId;
  }

  const res = await fetch(`${KICK_API_BASE}/public/v1/events/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick subscribe failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

export async function getKickEventSubscriptions(accessToken: string): Promise<unknown[]> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/events/subscriptions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick get subscriptions failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

// --- Category / channel update ---

export async function searchKickCategory(
  accessToken: string,
  name: string
): Promise<{ id: number; name: string; slug: string } | null> {
  const url = `${KICK_API_BASE}/public/v2/categories?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const items = data.data ?? [];
  if (!Array.isArray(items) || items.length === 0) return null;
  const exact = items.find(
    (c: { name?: string }) => c.name?.toLowerCase() === name.toLowerCase()
  );
  const cat = exact ?? items[0];
  return { id: cat.id, name: cat.name, slug: cat.slug };
}

export async function updateChannelCategory(
  accessToken: string,
  categoryId: number
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ category_id: categoryId }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err.slice(0, 100) };
  }
  return { ok: true };
}

/** Kick website API (kick.com) - public channel data. Cached 5 min in KV. */
const KICK_CHANNEL_STATS_KEY = 'kick_channel_stats_cache';
const KICK_CHANNEL_STATS_TTL_SEC = 300;

export interface KickChannelStats {
  followers: number | null;
  subscribers: number | null;
  slug: string | null;
}

/** Fetch follower and subscriber counts for the broadcaster's channel. Uses kick.com public API; cached 5 min. */
export async function getKickChannelStats(): Promise<KickChannelStats> {
  let slug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!slug?.trim()) {
    // Fallback: fetch slug from OAuth channels if we have a token
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      try {
        const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const ch = (data.data ?? [])[0];
          slug = ch?.slug ?? null;
          if (slug && typeof slug === 'string') {
            await kv.set(KICK_BROADCASTER_SLUG_KEY, slug);
          }
        }
      } catch {
        // ignore
      }
    }
    if (!slug?.trim()) return { followers: null, subscribers: null, slug: null };
  }

  const cacheKey = `${KICK_CHANNEL_STATS_KEY}:${slug}`;
  try {
    const cached = await kv.get<{ followers: number; subscribers: number; at: number }>(cacheKey);
    if (cached && cached.at && Date.now() - cached.at < KICK_CHANNEL_STATS_TTL_SEC * 1000) {
      return { followers: cached.followers ?? null, subscribers: cached.subscribers ?? null, slug };
    }
  } catch {
    // ignore cache errors
  }

  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TazoApp/1.0 (stream-integration)',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return { followers: null, subscribers: null, slug };

    const data = (await res.json()) as Record<string, unknown>;
    const followers =
      typeof data.followers_count === 'number'
        ? data.followers_count
        : typeof (data as { followersCount?: number }).followersCount === 'number'
          ? (data as { followersCount: number }).followersCount
          : null;
    const subscribers =
      typeof data.subscribers_count === 'number'
        ? data.subscribers_count
        : typeof (data as { subscriber_count?: number }).subscriber_count === 'number'
          ? (data as { subscriber_count: number }).subscriber_count
          : typeof (data as { subscription_count?: number }).subscription_count === 'number'
            ? (data as { subscription_count: number }).subscription_count
            : null;

    const toCache = { followers: followers ?? 0, subscribers: subscribers ?? 0, at: Date.now() };
    await kv.set(cacheKey, toCache, { ex: KICK_CHANNEL_STATS_TTL_SEC });

    return { followers, subscribers, slug };
  } catch {
    return { followers: null, subscribers: null, slug };
  }
}


