/**
 * Drop-in KV client using @upstash/redis directly.
 * Replaces the deprecated @vercel/kv package while keeping the same API surface.
 * Uses the same KV_REST_API_URL / KV_REST_API_TOKEN env vars set by Vercel/Upstash.
 */

import { Redis } from '@upstash/redis';

export const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
