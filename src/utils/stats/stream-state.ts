import { kv } from '@/lib/kv';

export const STREAM_STARTED_AT_KEY = 'stream_started_at';
const STREAM_ENDED_AT_KEY = 'stream_ended_at';
const STREAM_IS_LIVE_KEY = 'stream_is_live';
const STREAM_LAST_WEBHOOK_AT_KEY = 'stream_last_webhook_at';
const STREAM_LAST_CRON_CHECK_AT_KEY = 'stream_last_cron_check_at';

export interface StreamState {
  isLive: boolean;
  startedAt: number | null;
  endedAt: number | null;
  lastWebhookAt: number | null;
  lastCronCheckAt: number | null;
}

/**
 * Called when stream goes live. Sets stream_started_at for session-based stats; clears stream_ended_at.
 */
export async function onStreamStarted(): Promise<void> {
  try {
    const now = Date.now();
    await kv.set(STREAM_STARTED_AT_KEY, now);
    await kv.set(STREAM_ENDED_AT_KEY, null);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Stats] Stream started, session reset at', new Date(now).toISOString());
    }
  } catch (error) {
    console.warn('Failed to set stream started:', error);
  }
}

/**
 * Gets stream_started_at timestamp (ms) or null if never set
 */
export async function getStreamStartedAt(): Promise<number | null> {
  try {
    const val = await kv.get<number>(STREAM_STARTED_AT_KEY);
    return typeof val === 'number' ? val : null;
  } catch {
    return null;
  }
}

/**
 * Gets stream_ended_at timestamp (ms) or null if stream has not ended
 */
export async function getStreamEndedAt(): Promise<number | null> {
  try {
    const val = await kv.get<number | null>(STREAM_ENDED_AT_KEY);
    return typeof val === 'number' ? val : null;
  } catch {
    return null;
  }
}

// In-memory cache for the live flag — it changes rarely (only on webhooks/cron).
// 30s TTL strikes a balance: stale overlay data for at most 30s if a webhook is missed.
const LIVE_CACHE_TTL = 30_000;

declare global {
  var __streamLiveCache: { value: boolean; expiresAt: number } | undefined;
}

export async function setStreamLive(live: boolean): Promise<void> {
  await kv.set(STREAM_IS_LIVE_KEY, live);
  // Keep cache consistent immediately so subsequent calls don't re-fetch.
  globalThis.__streamLiveCache = { value: live, expiresAt: Date.now() + LIVE_CACHE_TTL };
}

export async function isStreamLive(): Promise<boolean> {
  const now = Date.now();
  const cached = globalThis.__streamLiveCache;
  if (cached && now < cached.expiresAt) return cached.value;

  const val = await kv.get<boolean>(STREAM_IS_LIVE_KEY);
  const isLive = val === true;
  globalThis.__streamLiveCache = { value: isLive, expiresAt: now + LIVE_CACHE_TTL };
  return isLive;
}

/** Called when stream ends. Sets stream_ended_at so uptime and session stats stop updating. */
export async function setStreamEndedAt(timestamp: number): Promise<void> {
  try {
    await kv.set(STREAM_ENDED_AT_KEY, timestamp);
    if (process.env.NODE_ENV === 'development') {
      console.log('[Stats] Stream ended at', new Date(timestamp).toISOString());
    }
  } catch (error) {
    console.warn('Failed to set stream ended:', error);
  }
}

/**
 * Returns a consolidated view of stream live/session state.
 */
export async function getStreamState(): Promise<StreamState> {
  const [live, startedAt, endedAt, lastWebhookAt, lastCronCheckAt] = await Promise.all([
    isStreamLive(),
    getStreamStartedAt(),
    getStreamEndedAt(),
    kv.get<number | null>(STREAM_LAST_WEBHOOK_AT_KEY),
    kv.get<number | null>(STREAM_LAST_CRON_CHECK_AT_KEY),
  ]);
  return {
    isLive: live,
    startedAt,
    endedAt,
    lastWebhookAt: typeof lastWebhookAt === 'number' ? lastWebhookAt : null,
    lastCronCheckAt: typeof lastCronCheckAt === 'number' ? lastCronCheckAt : null,
  };
}

/**
 * Called when Kick webhook reports livestream.status.updated.
 */
export async function markStreamLiveFromWebhook(isLive: boolean, timestamp: number): Promise<void> {
  try {
    if (isLive) {
      await Promise.all([
        setStreamLive(true),
        onStreamStarted(),
      ]);
    } else {
      await Promise.all([
        setStreamLive(false),
        setStreamEndedAt(timestamp),
      ]);
    }
    await kv.set(STREAM_LAST_WEBHOOK_AT_KEY, timestamp);
  } catch (error) {
    console.warn('Failed to update stream state from webhook:', error);
  }
}

/**
 * Called from cron after checking the Kick channel API.
 * Heals STREAM_IS_LIVE_KEY when API truth disagrees with KV (e.g. missed webhooks)
 */
export async function healStreamStateFromKickAPI(apiIsLive: boolean | null): Promise<void> {
  try {
    const now = Date.now();
    await kv.set(STREAM_LAST_CRON_CHECK_AT_KEY, now);
    if (apiIsLive === null) return;
    const kvLive = await isStreamLive();
    if (apiIsLive !== kvLive) {
      await setStreamLive(apiIsLive);
    }
  } catch (error) {
    console.warn('Failed to heal stream state from Kick API:', error);
  }
}
