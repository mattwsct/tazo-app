/**
 * Wise webhook receiver.
 * Listens for `balances#update` events and deducts from the stream wallet on card spend.
 *
 * Setup:
 * 1. Add WISE_API_TOKEN to env (Wise settings → Developer → API tokens, Full Access).
 * 2. Register webhook (run once after deploying):
 *    curl -X POST "https://api.transferwise.com/v3/profiles/{profileId}/subscriptions" \
 *      -H "Authorization: Bearer $WISE_API_TOKEN" \
 *      -H "Content-Type: application/json" \
 *      -d '{"name":"tazo-wallet","trigger_on":"balances#update","delivery":{"version":"3.0.0","url":"https://app.tazo.wtf/api/webhooks/wise"}}'
 * 3. Wise verifies the URL on registration by sending a POST — this handler responds 200 to all valid signed requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getWallet, deductFromWallet } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';

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
    // Wise sends an unsigned verification ping when registering the webhook — respond 200
    console.log('[Wise Webhook] Verification ping (no signature)');
    return NextResponse.json({ ok: true });
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

  // Acknowledge pings and non-debit events immediately
  if (eventType !== 'balances#update') {
    return NextResponse.json({ ok: true });
  }

  const data = payload.data as Record<string, unknown> | undefined;

  // Only act on debits (card spending), ignore credits (money coming in)
  const transactionType = data?.transaction_type as string | undefined;
  if (transactionType !== 'debit') {
    console.log('[Wise Webhook] Skipping non-debit update', JSON.stringify({ transactionType }));
    return NextResponse.json({ ok: true, skipped: 'not_debit' });
  }

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

  // Convert local currency spend to USD using stored rate
  const amountUsd = amount / localRate;
  const channelName = (data?.channel_name as string | undefined) ?? 'WISE';

  const { state, deducted } = await deductFromWallet(amountUsd, { currency: localCurrency, rate: localRate }, channelName.toUpperCase());
  void broadcastChallenges().catch(() => {});

  console.log('[Wise Webhook] DEDUCTED', JSON.stringify({
    localAmount: amount,
    currency,
    channelName,
    amountUsd: amountUsd.toFixed(2),
    deducted: deducted.toFixed(2),
    newBalance: state.balance,
  }));

  return NextResponse.json({ ok: true, deducted });
}
