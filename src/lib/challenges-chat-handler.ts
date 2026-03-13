/**
 * Challenges & Wallet chat commands — mods and broadcaster only (except !wallet balance check).
 *
 * !challenge <bounty> <description>  — add a challenge (e.g. !challenge 50 Do 20 pushups)
 * !challenge done <id>              — mark challenge #id as completed
 * !challenge fail <id>              — mark challenge #id as failed
 * !challenge remove <id>            — remove challenge #id entirely
 * !challenge clear                  — remove all completed/failed challenges
 * !challenge list                   — list active challenges
 *
 * !wallet                           — show current wallet balance (public)
 * !wallet <amount>                  — add USD amount to wallet (mods only)
 *
 * !spent <amount>                   — deduct amount (in local currency, auto-converted to USD) from wallet (mods only)
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import {
  getChallenges,
  addChallenge,
  updateChallengeStatus,
  removeChallenge,
  clearResolvedChallenges,
  getWallet,
  addToWallet,
  deductFromWallet,
} from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { COUNTRY_CURRENCY, getLocalCurrencyContext } from '@/utils/local-currency';

export interface HandleChallengesCommandResult {
  handled: boolean;
  reply?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: 'A$', EUR: '€', BRL: 'R$', CAD: 'C$', CNY: '¥', DKK: 'kr',
  GBP: '£', HKD: 'HK$', HUF: 'Ft', INR: '₹', IDR: 'Rp', ILS: '₪',
  JPY: '¥', KRW: '₩', MXN: '$', NZD: 'NZ$', NOK: 'kr', PLN: 'zł',
  RON: 'lei', RUB: '₽', SAR: '﷼', SGD: 'S$', ZAR: 'R', SEK: 'kr',
  CHF: 'Fr', THB: '฿', TRY: '₺', UAH: '₴', USD: '$', AED: 'د.إ',
  TWD: 'NT$', VND: '₫', PHP: '₱', MYR: 'RM',
};


function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)} USD`;
}

export async function handleChallengesCommand(
  content: string,
  sender: string,
  senderPayload: unknown
): Promise<HandleChallengesCommandResult> {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  const isChallenge = lower === '!challenge' || lower.startsWith('!challenge ');
  const isWallet = lower === '!wallet' || lower.startsWith('!wallet ');
  const isSpent = lower === '!spent' || lower.startsWith('!spent ');

  if (!isChallenge && !isWallet && !isSpent) return { handled: false };

  // !wallet (no args) — public, anyone can check balance
  if (lower === '!wallet') {
    const wallet = await getWallet();
    return { handled: true, reply: `💰 Wallet: ${formatUsd(wallet.balance)}` };
  }

  // All other commands require mod/broadcaster
  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(senderPayload, sender, broadcasterSlug)) {
    return { handled: true }; // silently ignore non-mods
  }

  // ── !wallet <amount> ── add to wallet ────────────────────────────────────────
  if (isWallet) {
    const arg = trimmed.slice('!wallet'.length).trim();
    const amount = parseFloat(arg);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { handled: true, reply: 'Usage: !wallet <amount>  e.g. !wallet 20' };
    }
    const state = await addToWallet(amount);
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `💰 Added ${formatUsd(amount)} to wallet → Balance: ${formatUsd(state.balance)}` };
  }

  // ── !spent <amount> ── deduct local currency, convert to USD ─────────────────
  if (isSpent) {
    const arg = trimmed.slice('!spent'.length).trim();
    const amount = parseFloat(arg);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { handled: true, reply: 'Usage: !spent <amount>  (uses your local currency)' };
    }
    const localCtx = await getLocalCurrencyContext();
    const currency = localCtx?.currency ?? 'USD';
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    let usd: number;
    let localContext: { currency: string; rate: number } | undefined;
    if (localCtx && localCtx.currency !== 'USD') {
      usd = Math.round((amount / localCtx.rate) * 100) / 100;
      localContext = localCtx;
    } else {
      // USD or unknown — treat amount as USD
      usd = amount;
      localContext = undefined;
    }
    if (!Number.isFinite(usd) || usd <= 0) {
      return { handled: true, reply: `⚠️ Could not convert ${currency} to USD. Try !wallet <usd_amount> instead.` };
    }
    const { state, deducted } = await deductFromWallet(usd, localContext);
    void broadcastChallenges().catch(() => {});
    return {
      handled: true,
      reply: `💸 Spent ${symbol}${amount} ${currency} = ${formatUsd(deducted)} → Wallet: ${formatUsd(state.balance)}`,
    };
  }

  // ── !challenge ... ────────────────────────────────────────────────────────────
  const args = trimmed.slice('!challenge'.length).trim();
  const argsLower = args.toLowerCase();

  if (!args || args === 'help') {
    return {
      handled: true,
      reply: 'Usage: !challenge <bounty> <desc> | done/fail/remove <id> | clear | list',
    };
  }

  // !challenge list
  if (argsLower === 'list') {
    const state = await getChallenges();
    const active = state.challenges.filter((c) => c.status === 'active');
    if (active.length === 0) return { handled: true, reply: 'No active challenges.' };
    const list = active.map((c, i) => `${i + 1}. $${c.bounty} — ${c.description}`).join(' | ');
    return { handled: true, reply: `📋 Challenges: ${list}` };
  }

  // !challenge clear
  if (argsLower === 'clear') {
    const removed = await clearResolvedChallenges();
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `✅ Cleared ${removed} resolved challenge${removed !== 1 ? 's' : ''}` };
  }

  // !challenge done <id>
  if (argsLower.startsWith('done ') || argsLower === 'done') {
    const idStr = args.slice(4).trim();
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) return { handled: true, reply: 'Usage: !challenge done <id>' };
    const c = await updateChallengeStatus(id, 'completed');
    if (!c) return { handled: true, reply: `Challenge #${id} not found.` };
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `✅ Challenge #${id} completed! ($${c.bounty} — ${c.description})` };
  }

  // !challenge fail <id>
  if (argsLower.startsWith('fail ') || argsLower === 'fail') {
    const idStr = args.slice(4).trim();
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) return { handled: true, reply: 'Usage: !challenge fail <id>' };
    const c = await updateChallengeStatus(id, 'failed');
    if (!c) return { handled: true, reply: `Challenge #${id} not found.` };
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `❌ Challenge #${id} failed ($${c.bounty} — ${c.description})` };
  }

  // !challenge remove <id>
  if (argsLower.startsWith('remove ') || argsLower === 'remove') {
    const idStr = args.slice(6).trim();
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) return { handled: true, reply: 'Usage: !challenge remove <id>' };
    const ok = await removeChallenge(id);
    if (!ok) return { handled: true, reply: `Challenge #${id} not found.` };
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `🗑️ Challenge #${id} removed` };
  }

  // !challenge <bounty> [<duration>] <description>
  // Duration is optional: e.g. 10m, 30s, 1h — must come before description
  const parts = args.split(/\s+/);
  const bounty = parseFloat(parts[0]);
  if (!Number.isFinite(bounty) || bounty < 0) {
    return { handled: true, reply: 'Usage: !challenge <bounty> [time] <desc>  e.g. !challenge 50 10m Do 20 pushups' };
  }

  let expiresAt: number | undefined;
  let descStart = 1;
  if (parts.length > 2) {
    const durationMatch = parts[1].match(/^([\d.]+)(s|sec|secs|m|min|mins|h|hr|hrs)$/i);
    if (durationMatch) {
      const num = parseFloat(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      let ms: number;
      if (unit.startsWith('h')) ms = num * 3_600_000;
      else if (unit.startsWith('m')) ms = num * 60_000;
      else ms = num * 1_000;
      expiresAt = Date.now() + Math.round(ms);
      descStart = 2;
    }
  }

  const description = parts.slice(descStart).join(' ').trim();
  if (!description) {
    return { handled: true, reply: 'Usage: !challenge <bounty> [time] <desc>  e.g. !challenge 50 10m Do 20 pushups' };
  }
  const item = await addChallenge(bounty, description, expiresAt);
  void broadcastChallenges().catch(() => {});
  const timerSuffix = expiresAt ? ` (${parts[descStart - 1]} to complete)` : '';
  return {
    handled: true,
    reply: `📋 Challenge #${item.id} added: $${item.bounty} — ${item.description}${timerSuffix}`,
  };
}
