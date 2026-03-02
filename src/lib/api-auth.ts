// === 🔐 API AUTHENTICATION UTILITIES ===
// Session tokens are HMAC-SHA256 signed with ADMIN_PASSWORD.
// No KV storage needed — validated purely by signature + expiry on every request.
// Changing ADMIN_PASSWORD immediately invalidates all existing sessions.

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEV_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in dev

function getSecret(): string {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'unconfigured';
}

/** Generate a signed session token: "<expiry_ms>.<hmac_hex>" */
export function generateSessionToken(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const exp = Date.now() + (isDev ? DEV_SESSION_MAX_AGE_MS : SESSION_MAX_AGE_MS);
  const payload = String(exp);
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Verify a session token's signature and expiry. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = parseInt(payload, 10);
  if (isNaN(exp) || Date.now() > exp) return false;
  const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    return false; // buffers differ in length → invalid
  }
}

/**
 * Verify auth from server component / route handler without a request object.
 * Uses Next.js `cookies()` API.
 */
export async function verifyAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get('auth-token')?.value);
}

/**
 * Verify auth directly from a NextRequest (for route handlers that receive `request`).
 * Avoids the `cookies()` async wrapper overhead.
 */
export function verifyRequestAuth(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get('auth-token')?.value);
}

// === 📊 KV USAGE TRACKING ===

let kvReadCount = 0;
let kvWriteCount = 0;
let kvUsageStartTime = Date.now();

declare global {
  var kvUsageReset: number | undefined;
}

if (typeof global !== 'undefined' && !global.kvUsageReset) {
  global.kvUsageReset = Date.now();
  kvReadCount = 0;
  kvWriteCount = 0;
  kvUsageStartTime = Date.now();
}

export function logKVUsage(operation: 'read' | 'write') {
  if (operation === 'read') kvReadCount++;
  if (operation === 'write') kvWriteCount++;

  const total = kvReadCount + kvWriteCount;
  const hoursSinceStart = (Date.now() - kvUsageStartTime) / (1000 * 60 * 60);
  const readsPerHour = kvReadCount / Math.max(hoursSinceStart, 0.001);
  const writesPerHour = kvWriteCount / Math.max(hoursSinceStart, 0.001);

  if (total % 100 === 0) {
    console.log(`📊 KV Usage: ${kvReadCount} reads, ${kvWriteCount} writes (${total} total)`);
    if (readsPerHour > 1000 || writesPerHour > 1000) {
      console.warn(`⚠️ HIGH KV USAGE: ${readsPerHour.toFixed(1)} reads/hr, ${writesPerHour.toFixed(1)} writes/hr`);
    }
  }
  if (total % 1000 === 0) {
    const projectedReads = readsPerHour * 24 * 30;
    const projectedWrites = writesPerHour * 24 * 30;
    if (projectedReads > 80000 || projectedWrites > 80000) {
      console.warn(`🚨 MONTHLY KV PROJECTION: ${projectedReads.toFixed(0)} reads, ${projectedWrites.toFixed(0)} writes (limit: 100k each)`);
    }
  }
}
