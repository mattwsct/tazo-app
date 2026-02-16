/**
 * Kick API proxy - forwards authenticated requests to api.kick.com.
 * Used by admin panel for channels, rewards, leaderboard, moderation, etc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { refreshKickTokens } from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';

const KICK_API_BASE = 'https://api.kick.com';
const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

async function getBroadcasterUserId(accessToken: string): Promise<number | null> {
  const res = await fetch(`${KICK_API_BASE}/public/v1/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const ch = (data.data ?? [])[0];
  return ch?.broadcaster_user_id ?? ch?.user_id ?? null;
}

async function getValidAccessToken(): Promise<string | null> {
  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) return null;

  const now = Date.now();
  const bufferMs = 60 * 1000;
  if (stored.expires_at - bufferMs > now) {
    return stored.access_token;
  }

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

type KickApiAction =
  | 'getChannel'
  | 'patchChannel'
  | 'getRewards'
  | 'getRedemptions'
  | 'acceptRedemptions'
  | 'rejectRedemptions'
  | 'getLeaderboard'
  | 'getLivestreams'
  | 'getLivestreamStats'
  | 'getCategories'
  | 'getCategory'
  | 'postBan'
  | 'deleteBan'
  | 'getUsers'
  | 'getSubscriptions';

const ACTION_TO_OPTIONS: Record<
  KickApiAction,
  { method: string; path: string; query?: Record<string, string>; bodyKey?: string }
> = {
  getChannel: { method: 'GET', path: '/public/v1/channels' },
  patchChannel: { method: 'PATCH', path: '/public/v1/channels', bodyKey: 'body' },
  getRewards: { method: 'GET', path: '/public/v1/channels/rewards' },
  getRedemptions: { method: 'GET', path: '/public/v1/channels/rewards/redemptions' },
  acceptRedemptions: { method: 'POST', path: '/public/v1/channels/rewards/redemptions/accept', bodyKey: 'ids' },
  rejectRedemptions: { method: 'POST', path: '/public/v1/channels/rewards/redemptions/reject', bodyKey: 'ids' },
  getLeaderboard: { method: 'GET', path: '/public/v1/kicks/leaderboard' },
  getLivestreams: { method: 'GET', path: '/public/v1/livestreams' },
  getLivestreamStats: { method: 'GET', path: '/public/v1/livestreams/stats' },
  getCategories: { method: 'GET', path: '/public/v2/categories' },
  getCategory: { method: 'GET', path: '/public/v1/categories' }, // path += '/' + body.category_id
  postBan: { method: 'POST', path: '/public/v1/moderation/bans', bodyKey: 'body' },
  deleteBan: { method: 'DELETE', path: '/public/v1/moderation/bans', bodyKey: 'body' },
  getUsers: { method: 'GET', path: '/public/v1/users' },
  getSubscriptions: { method: 'GET', path: '/public/v1/events/subscriptions' },
};

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Not connected to Kick' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = body.action as KickApiAction;
    const opts = ACTION_TO_OPTIONS[action];
    if (!opts) {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    let path = opts.path;
    if (action === 'getCategory' && body.category_id != null) {
      path += '/' + encodeURIComponent(String(body.category_id));
    }
    let url = `${KICK_API_BASE}${path}`;
    const query = body.query ?? opts.query ?? {};
    const qKeys = Object.keys(query).filter((k) => query[k] != null && query[k] !== '');
    if (qKeys.length > 0) {
      const params = new URLSearchParams();
      for (const k of qKeys) {
        const v = query[k];
        if (Array.isArray(v)) {
          v.forEach((x) => params.append(k, String(x)));
        } else {
          params.set(k, String(v));
        }
      }
      url += '?' + params.toString();
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    let fetchBody: string | undefined;
    if (opts.bodyKey && body[opts.bodyKey] !== undefined) {
      let payload: Record<string, unknown> =
        opts.bodyKey === 'body' ? (body.body as Record<string, unknown>) ?? {} : opts.bodyKey === 'ids' ? { ids: body.ids } : (body[opts.bodyKey] as Record<string, unknown>) ?? {};
      if (action === 'postBan' || action === 'deleteBan') {
        if (!payload.broadcaster_user_id) {
          const bid = await getBroadcasterUserId(accessToken);
          if (bid) payload = { ...payload, broadcaster_user_id: bid };
        }
      }
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(payload);
    }

    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: fetchBody,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Kick API ${res.status}`, data },
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Kick API request failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
