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
import { kv } from '@/lib/kv';
import { getWallet, deductFromWallet, setTotalSpent } from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { isStreamLive } from '@/utils/stats/stream-state';
import { NO_DECIMAL_CURRENCIES } from '@/utils/currency-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

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

  // Verify signature — Wise signs all delivery events with their RSA private key
  if (signature) {
    try {
      const publicKey = await getWisePublicKey();
      const valid = verifySignature(rawBody, signature, publicKey);
      console.log('[Wise Webhook] Signature check:', valid ? 'PASS' : 'FAIL');
      if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    } catch (err) {
      console.error('[Wise Webhook] Could not verify signature:', err);
    }
  } else {
    console.log('[Wise Webhook] No signature header — treating as ping');
  }

  console.log('[Wise Webhook] RAW_PAYLOAD', JSON.stringify(JSON.parse(rawBody.toString('utf8'))));

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

  // Only process transactions while streaming live
  const live = await isStreamLive();
  if (!live) {
    console.log('[Wise Webhook] Skipping — stream is not live');
    return NextResponse.json({ ok: true, skipped: 'not_live' });
  }

  // Only process transactions from the configured card (Apple Pay card)
  const allowedCard = process.env.WISE_CARD_LAST_FOUR;
  if (allowedCard) {
    const profileId = process.env.WISE_PROFILE_ID;
    const balanceId = process.env.WISE_BALANCE_ID;
    const token = process.env.WISE_API_TOKEN;
    if (profileId && balanceId && token) {
      try {
        const now = new Date();
        const since = new Date(now.getTime() - 10 * 60 * 1000).toISOString(); // last 10 minutes
        const stmtRes = await fetch(
          `https://api.transferwise.com/v1/profiles/${profileId}/balance-statements/${balanceId}/statement.json?intervalStart=${since}&intervalEnd=${now.toISOString()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (stmtRes.ok) {
          const stmt = await stmtRes.json() as { transactions?: Array<{ details?: { type?: string; cardLastFourDigits?: string } }> };
          const recentCardTx = stmt.transactions?.find(t => t.details?.type === 'CARD');
          if (!recentCardTx) {
            console.log('[Wise Webhook] Skipping — no recent card transaction found');
            return NextResponse.json({ ok: true, skipped: 'no_card_tx' });
          }
          const last4 = recentCardTx.details?.cardLastFourDigits;
          if (last4 !== allowedCard) {
            console.log('[Wise Webhook] Skipping — card', last4, 'not allowed (want', allowedCard + ')');
            return NextResponse.json({ ok: true, skipped: 'wrong_card' });
          }
        }
      } catch (err) {
        console.error('[Wise Webhook] Failed to verify card:', err);
      }
    }
  }

  const rawAmount = data?.amount as number | undefined;
  const currency = (data?.currency as string | undefined)?.toUpperCase();

  // Wise may send negative amounts for debits (balance decreases) — normalise to positive
  const amount = typeof rawAmount === 'number' ? Math.abs(rawAmount) : undefined;

  if (typeof amount !== 'number' || amount === 0 || !currency) {
    console.warn('[Wise Webhook] Missing or invalid amount/currency', JSON.stringify({ rawAmount, currency }));
    return NextResponse.json({ error: 'Missing amount or currency' }, { status: 400 });
  }

  const wallet = await getWallet();
  const localCurrency = wallet.localCurrency?.toUpperCase();
  const localRate = wallet.localRate;

  // Step 1: Convert Wise account currency (e.g. AUD) → USD.
  // The Wise balance currency is never the local spend currency when travelling,
  // so we always fetch a live rate — even if it happens to match localCurrency.
  let amountUsd: number;
  if (currency === 'USD') {
    amountUsd = amount;
  } else {
    try {
      const rateRes = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 3600 } });
      if (!rateRes.ok) throw new Error(`Rate fetch failed: ${rateRes.status}`);
      const rateData = await rateRes.json() as { rates?: Record<string, number> };
      const rate = rateData.rates?.[currency];
      if (!rate) {
        console.warn('[Wise Webhook] No exchange rate for currency — skipping', JSON.stringify({ currency }));
        return NextResponse.json({ ok: true, skipped: 'no_rate' });
      }
      amountUsd = amount / rate;
    } catch (err) {
      console.error('[Wise Webhook] Failed to fetch exchange rate:', err);
      return NextResponse.json({ ok: true, skipped: 'rate_fetch_error' });
    }
  }

  // Step 2: Express the spend in the overlay's local currency (e.g. THB).
  // This is what shows on the overlay and in chat — not the Wise account currency.
  const localAmount = localCurrency && localRate ? amountUsd * localRate : undefined;
  const localContext = localCurrency && localRate
    ? { currency: localCurrency, rate: localRate, localAmount }
    : undefined;

  const channelName = (data?.channel_name as string | undefined) ?? 'WISE';

  const overlaySettings = await kv.get<Record<string, unknown>>('overlay_settings');
  const walletEnabled = (overlaySettings?.walletEnabled as boolean) ?? true;

  // Always update totalSpent — spent tracking is independent of wallet state.
  const current = await getWallet();
  const newTotalSpent = Math.round(((current.totalSpent ?? 0) + amountUsd) * 100) / 100;
  await setTotalSpent(newTotalSpent);

  // Also deduct from wallet balance when wallet is enabled.
  if (walletEnabled) {
    await deductFromWallet(amountUsd, localContext, channelName.toUpperCase());
  }

  void broadcastChallenges().catch(() => {});

  // Post chat message: show local currency amount + USD equivalent
  void (async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) return;
      const usdRounded = Math.round(amountUsd * 100) / 100;
      const usdStr = usdRounded % 1 === 0 ? `$${usdRounded.toFixed(0)}` : `$${usdRounded.toFixed(2)}`;
      let msg: string;
      if (localAmount && localCurrency) {
        const CHAT_CURRENCY_SYMBOLS: Record<string, string> = {
          USD: '$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$',
          EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩', INR: '₹',
          BRL: 'R$', CHF: 'Fr', THB: '฿', PHP: '₱', IDR: 'Rp', MYR: 'RM',
          VND: '₫', TWD: 'NT$', ZAR: 'R', TRY: '₺', PLN: 'zł', ILS: '₪',
          AED: 'د.إ', RUB: '₽', UAH: '₴', NGN: '₦', KES: 'KSh', EGP: 'E£',
          PKR: '₨', GHS: 'GH₵',
        };
        const AMBIGUOUS = new Set(['SEK', 'NOK', 'DKK', 'MXN', 'ARS', 'CLP', 'COP', 'CZK', 'HUF', 'RON', 'SAR', 'GHS']);
        const sym = AMBIGUOUS.has(localCurrency) ? null : (CHAT_CURRENCY_SYMBOLS[localCurrency] ?? null);
        let localStr: string;
        if (NO_DECIMAL_CURRENCIES.has(localCurrency)) {
          localStr = Math.round(localAmount).toLocaleString();
        } else {
          const r = Math.round(localAmount * 100) / 100;
          localStr = r % 1 === 0 ? Math.round(r).toLocaleString() : r.toFixed(2);
        }
        const localFormatted = sym ? `${sym}${localStr}` : `${localStr} ${localCurrency}`;
        msg = `💳 CARD -${localFormatted} (-${usdStr} USD)`;
      } else {
        msg = `💳 CARD -${usdStr} USD`;
      }
      await sendKickChatMessage(token, msg);
    } catch { /* non-critical */ }
  })();

  console.log('[Wise Webhook] SPENT', JSON.stringify({
    wiseAmount: amount,
    wiseCurrency: currency,
    amountUsd: amountUsd.toFixed(2),
    localAmount: localAmount?.toFixed(2),
    localCurrency,
    channelName,
    newTotalSpent,
  }));

  return NextResponse.json({ ok: true, totalSpent: newTotalSpent });
}
