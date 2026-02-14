/**
 * Kick.com API utilities for webhooks, OAuth, chat, and event subscriptions.
 * @see https://docs.kick.com
 */

import { createHash, randomBytes, createVerify, createPublicKey } from 'node:crypto';
import type { IncomingHttpHeaders } from 'http';

// --- Constants ---

export const KICK_API_BASE = 'https://api.kick.com';
export const KICK_OAUTH_BASE = 'https://id.kick.com';

export const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

/** Scopes needed for bot: chat, events, channel rewards (for redemptions) */
export const KICK_SCOPES = [
  'chat:write',
  'events:subscribe',
  'channel:rewards:read',
].join(' ');

/** All event types we subscribe to */
export const KICK_EVENT_SUBSCRIPTIONS = [
  { name: 'channel.followed', version: 1 },
  { name: 'channel.subscription.new', version: 1 },
  { name: 'channel.subscription.renewal', version: 1 },
  { name: 'channel.subscription.gifts', version: 1 },
  { name: 'kicks.gifted', version: 1 },
  { name: 'channel.reward.redemption.updated', version: 1 },
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
    const payload = `${rawBody}.${timestamp}.${messageId}`;
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

// --- Chat ---

export async function sendKickChatMessage(
  accessToken: string,
  content: string
): Promise<{ is_sent: boolean; message_id?: string }> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ content, type: 'bot' }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kick chat send failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data ?? { is_sent: false };
}

// --- Event subscriptions ---

export async function subscribeToKickEvents(accessToken: string): Promise<unknown[]> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/events/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      events: KICK_EVENT_SUBSCRIPTIONS,
      method: 'webhook',
    }),
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
