/**
 * Wise webhook receiver.
 * Listens for `balances#debit` events (card spending) and deducts from the stream wallet.
 *
 * Setup:
 * 1. Add WISE_API_TOKEN to env (Wise settings → Developer → API tokens).
 * 2. Register webhook via Wise API:
 *    POST https://api.transferwise.com/v3/profiles/{profileId}/subscriptions
 *    Body: { "name": "tazo-wallet", "trigger_on": "balances#debit", "delivery": { "version": "2.0.0", "url": "https://your-domain/api/webhooks/wise" } }
 * 3. Wise signs payloads with their RSA private key; we verify using their public key.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getWallet, deductFromWallet } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { isStreamLive } from '@/utils/stats-storage';

export const dynamic = 'force-dynamic';

const WISE_PUBLIC_KEY_URL = 'https://api.transferwise.com/v1/subscriptions/webhooks/public-key';

// Cache the public key in memory — it changes extremely rarely
let cachedPublicKey: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getWisePublicKey(): Promise<string> {
  if (cachedPublicKey && Date.now() < cacheExpiry) return cachedPublicKey;

  const token = process.env.WISE_API_TOKEN;
  if (!token) throw new Error('WISE_API_TOKEN not set');

  const res = await fetch(WISE_PUBLIC_KEY_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Wise public key: ${res.status}`);

  const key = await res.text();
  cachedPublicKey = key.trim();
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedPublicKey;
}

function verifySignature(body: Buffer, signatureB64: string, publicKey: string): boolean {
  try {
    return crypto.createVerify('SHA256').update(body).verify(publicKey, signatureB64, 'base64');
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.WISE_API_TOKEN) {
    return NextResponse.json({ error: 'Wise integration not configured' }, { status: 503 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-signature-sha256');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // Verify signature
  let publicKey: string;
  try {
    publicKey = await getWisePublicKey();
  } catch (err) {
    console.error('[Wise Webhook] Failed to fetch public key:', err);
    return NextResponse.json({ error: 'Could not verify signature' }, { status: 500 });
  }

  if (!verifySignature(rawBody, signature, publicKey)) {
    console.warn('[Wise Webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = payload.event_type as string;
  console.log('[Wise Webhook] EVENT', JSON.stringify({ eventType }));

  if (eventType !== 'balances#debit') {
    // Acknowledge but ignore other event types
    return NextResponse.json({ ok: true });
  }

  const data = payload.data as Record<string, unknown> | undefined;
  const amount = data?.amount as number | undefined;
  const currency = (data?.currency as string | undefined)?.toUpperCase();

  if (typeof amount !== 'number' || amount <= 0 || !currency) {
    console.warn('[Wise Webhook] Missing or invalid amount/currency', JSON.stringify({ amount, currency }));
    return NextResponse.json({ error: 'Missing amount or currency' }, { status: 400 });
  }

  const wallet = await getWallet();
  const localCurrency = wallet.localCurrency?.toUpperCase();
  const localRate = wallet.localRate;

  if (!localCurrency || !localRate) {
    console.log('[Wise Webhook] No local currency context in wallet — skipping deduction');
    return NextResponse.json({ ok: true, skipped: 'no_local_currency' });
  }

  if (currency !== localCurrency) {
    console.log('[Wise Webhook] Currency mismatch — skipping', JSON.stringify({ eventCurrency: currency, walletCurrency: localCurrency }));
    return NextResponse.json({ ok: true, skipped: 'currency_mismatch' });
  }

  // Convert local currency spend to USD
  const amountUsd = amount / localRate;

  const { state, deducted } = await deductFromWallet(amountUsd, { currency: localCurrency, rate: localRate }, 'WISE');
  void broadcastChallenges().catch(() => {});

  const isLive = await isStreamLive();
  console.log('[Wise Webhook] DEDUCTED', JSON.stringify({
    localAmount: amount,
    currency,
    amountUsd: amountUsd.toFixed(2),
    deducted: deducted.toFixed(2),
    newBalance: state.balance,
    isLive,
  }));

  return NextResponse.json({ ok: true, deducted });
}
