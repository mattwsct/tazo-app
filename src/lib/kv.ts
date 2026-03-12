/**
 * Drop-in KV client using @upstash/redis directly.
 * Replaces the deprecated @vercel/kv package while keeping the same API surface.
 * Uses the same KV_REST_API_URL / KV_REST_API_TOKEN env vars set by Vercel/Upstash.
 */

import { Redis } from '@upstash/redis';

const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;
if (!kvUrl || !kvToken) {
  throw new Error('Missing required env vars: KV_REST_API_URL and KV_REST_API_TOKEN must be set');
}

export const kv = new Redis({ url: kvUrl, token: kvToken });
