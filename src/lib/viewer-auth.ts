// === Viewer Session Authentication ===
// HMAC-SHA256 signed tokens stored as a cookie named `viewer-token`.
// Token format: <payload_b64>.<hmac_hex>
// Payload: base64-encoded JSON containing viewer identity + expiry.

import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

export interface ViewerTokenData {
  viewerUuid: string;  // generated on first connect, preserved forever
  kickId?: string;
  kickUsername?: string;
  discordId?: string;
  discordUsername?: string;
  exp: number;
}

const COOKIE_NAME = 'viewer-token';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): string {
  return process.env.VIEWER_SESSION_SECRET ?? 'tazo_viewer_fallback_secret_change_in_prod';
}

export function createViewerToken(data: ViewerTokenData): string {
  const secret = getSecret();
  const payloadJson = JSON.stringify(data);
  const payloadB64 = Buffer.from(payloadJson).toString('base64url');
  const hmac = createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${hmac}`;
}

export function verifyViewerToken(token: string): ViewerTokenData | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const secret = getSecret();
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('hex');

    // Timing-safe comparison requires equal-length buffers
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const data = JSON.parse(payloadJson) as ViewerTokenData;

    // Check expiry
    if (!data.exp || Date.now() > data.exp) return null;

    return data;
  } catch {
    return null;
  }
}

export function getViewerSession(request: NextRequest): ViewerTokenData | null {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyViewerToken(token);
}

export { COOKIE_NAME as VIEWER_COOKIE_NAME, SESSION_TTL_MS as VIEWER_SESSION_TTL_MS };
