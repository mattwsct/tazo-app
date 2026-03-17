// KV-based rate limiting for public API endpoints (works across serverless instances)

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest } from 'next/server';

let ratelimitClient: Ratelimit | null = null;

function getRatelimitClient(): Ratelimit | null {
  if (ratelimitClient) return ratelimitClient;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const redis = new Redis({ url, token });
    ratelimitClient = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      analytics: false,
    });
    return ratelimitClient;
  } catch {
    return null;
  }
}

function getClientIdentifier(request: NextRequest | Request, endpoint: string): string {
  const req = request as NextRequest;
  const ip = req.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers?.get?.('x-real-ip')
    || 'unknown';
  return `${endpoint}:${ip}`;
}

/**
 * Check rate limit for public API endpoints. Uses KV for global limits across serverless instances.
 * 60 requests per minute per endpoint per IP.
 * Skipped in development — local requests have no x-forwarded-for so all resolve to "unknown",
 * making the limit meaningless and adding a needless KV round trip.
 */
export async function checkApiRateLimit(
  request: NextRequest | Request,
  endpoint: string
): Promise<{ success: boolean }> {
  if (process.env.NODE_ENV === 'development') return { success: true };
  const client = getRatelimitClient();
  if (!client) return { success: true };
  const identifier = getClientIdentifier(request, endpoint);
  const result = await client.limit(identifier);
  return { success: result.success };
}
