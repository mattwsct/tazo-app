/**
 * Challenges & Wallet chat commands — mods and broadcaster only (except !wallet / !buychallenge / !bc).
 *
 * !challenge / !ch steps                  — add a random tiered step challenge (based on current steps)
 * !challenge / !ch fitness                — add a random tiered fitness challenge
 * !challenge / !ch social                 — add a random tiered social challenge
 * !challenge / !ch <bounty> <description> — add a manual challenge (e.g. !ch 50 Do 20 pushups)
 * !challenge / !ch done <id>              — mark challenge #id as completed
 * !challenge / !ch fail <id>              — mark challenge #id as failed
 * !challenge / !ch remove <id>            — remove challenge #id (refunds credits if viewer-purchased)
 * !challenge / !ch done all               — complete all active challenges (award all bounties)
 * !challenge / !ch fail all               — fail all active challenges (deduct all bounties)
 * !challenge / !ch remove all             — remove all active challenges (no bounty effect)
 * !challenge / !ch clear                  — remove all completed/failed challenges
 * !challenge / !ch list                   — list active challenges
 * !challenges hide / !challenges show — hide/show challenges section on overlay
 * !bcon / !bcoff                    — enable/disable viewer !buychallenge command
 *
 * !buychallenge <desc> / !bc <desc> — viewers spend 1000 Credits for a $10 / 10-min challenge
 *
 * !wallet                           — show current wallet balance (public)
 * !wallet <amount>                  — add USD amount to wallet (mods only)
 * !wallet set <amount>              — set wallet to exact USD balance (mods only)
 * !wallet on / !wallet off          — enable/disable wallet (pauses accumulation when off)
 *
 * !spent                            — show current spent total (public)
 * !spent <amount>                   — deduct amount (in local currency, auto-converted to USD) from wallet (mods only)
 * !spent refund <amount>            — reverse a spend: subtract from spent total, add back to wallet (mods only)
 * !spent reset                      — reset the spent total counter to $0 (mods only)
 * !spent set <amount>               — manually set the spent total to a specific USD amount (mods only)
 *
 * !credits remove <user> <amount>   — deduct Credits from a user (mods only)
 * !help / !commands                 — list viewer-available commands (public)
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
  setWalletBalance,
  deductFromWallet,
  setTotalSpent,
  makeMovementChallenge,
  makeFitnessChallenge,
  makeSocialChallenge,
} from '@/utils/challenges-storage';
import { deductCredits, addCredits } from '@/utils/gambling-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';

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

  const isChallenge = lower === '!challenge' || lower.startsWith('!challenge ') || lower === '!ch' || lower.startsWith('!ch ');
  const isChallenges = lower === '!challenges hide' || lower === '!challenges show';
  const isWallet = lower === '!wallet' || lower.startsWith('!wallet ');
  const isSpent = lower === '!spent' || lower.startsWith('!spent ') || lower === '!spend' || lower.startsWith('!spend ');
  const isChatChallenge = lower.startsWith('!buychallenge ') || lower === '!buychallenge' || lower.startsWith('!bc ') || lower === '!bc';
  const isCCToggle = lower === '!bcon' || lower === '!bcoff';
  const isCreditsRemove = lower.startsWith('!credits remove ');
  const isHelp = lower === '!help' || lower === '!commands';

  if (!isChallenge && !isChallenges && !isWallet && !isSpent && !isChatChallenge && !isCCToggle && !isCreditsRemove && !isHelp) return { handled: false };

  // !help / !commands — public
  if (isHelp) {
    return {
      handled: true,
      reply: '📋 Commands — Stats: !heartrate !steps !distance !wellness !speed !altitude !uv !aqi | Info: !location !time !weather !uptime !followers !timers | Games: !bj !credits !leaderboard !give !8ball !dice !flip | Utils: !convert !math !poll !wallet !spent',
    };
  }

  // !credits remove <user> <amount> — mods only
  if (isCreditsRemove) {
    const slugForCredits = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
    if (!isModOrBroadcaster(senderPayload, sender, slugForCredits)) return { handled: true };
    const parts = trimmed.slice('!credits remove '.length).trim().split(/\s+/);
    const target = parts[0];
    const amount = parseInt(parts[1] ?? '', 10);
    if (!target || !Number.isFinite(amount) || amount <= 0) {
      return { handled: true, reply: 'Usage: !credits remove <user> <amount>  e.g. !credits remove Tazo 100' };
    }
    const result = await deductCredits(target, amount, 'mod remove');
    if (!result.ok) return { handled: true, reply: `⚠️ Could not remove Credits from ${target}.` };
    return { handled: true, reply: `✅ Removed ${amount} Credits from ${target}. They now have ${result.balance}.` };
  }

  // Check wallet enabled — gates challenges and buychallenge; wallet commands (!wallet on/off/hide/show) remain usable
  const overlaySettings = await kv.get<Record<string, unknown>>('overlay_settings');
  const walletEnabled = (overlaySettings?.walletEnabled as boolean) ?? true;

  // !wallet (no args) — public, anyone can check balance
  if (lower === '!wallet') {
    if (!walletEnabled) return { handled: true, reply: '⚠️ Wallet is currently disabled.' };
    const wallet = await getWallet();
    return { handled: true, reply: `💰 Wallet: ${formatUsd(wallet.balance)} — Each sub adds $5, 100 KICKs adds $1` };
  }

  const CC_ENABLED_KEY = 'chat_challenges_enabled';

  // !buychallenge <description> / !bc <description> — viewer spends 1000 Credits for a $10 / 15-min challenge
  if (isChatChallenge) {
    if (!walletEnabled) return { handled: true, reply: '⚠️ Wallet is disabled — challenges are not available.' };
    const cmdLen = lower.startsWith('!buychallenge') ? '!buychallenge'.length : '!bc'.length;
    const description = trimmed.slice(cmdLen).trim();
    if (!description) {
      return { handled: true, reply: 'Usage: !buychallenge <description>  Costs 1,000 Credits — adds a $10 challenge (10 min)' };
    }
    // Check enabled
    const ccEnabled = await kv.get<boolean>(CC_ENABLED_KEY);
    if (ccEnabled === false) {
      return { handled: true, reply: '⚠️ Viewer challenges are currently disabled.' };
    }
    const user = sender.toLowerCase().replace(/^@+/, '');
    // Check cap before deducting
    const state = await getChallenges();
    const activeCount = state.challenges.filter((c) => c.status === 'active').length;
    if (activeCount >= 5) {
      return { handled: true, reply: '⚠️ Challenge slots are full (max 5). Try again later!' };
    }
    const result = await deductCredits(user, 1000);
    if (!result.ok) {
      return { handled: true, reply: `❌ Not enough Credits — you need 1,000 (you have ${result.balance.toLocaleString()})` };
    }
    const expiresAt = Date.now() + 10 * 60_000;
    const item = await addChallenge(10, description, expiresAt, { buyerUsername: user });
    if (!item) {
      // Race condition: cap hit between check and insert — refund
      void addCredits(user, 1000, { skipExclusions: true }).catch(() => {});
      return { handled: true, reply: '⚠️ Challenge slots are full (max 5). Your Credits were not charged.' };
    }
    void broadcastChallenges().catch(() => {});
    return {
      handled: true,
      reply: `📋 @${sender} added a challenge: $10 — ${description} (10 min) — 1,000 Credits spent (${result.balance.toLocaleString()} remaining)`,
    };
  }

  // All other commands require mod/broadcaster
  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(senderPayload, sender, broadcasterSlug)) {
    return { handled: true }; // silently ignore non-mods
  }

  const OVERLAY_SETTINGS_KEY = 'overlay_settings';
  const notifyOverlay = () => void kv.set('overlay_settings_modified', Date.now()).catch(() => {});

  // ── !bcon / !bcoff ────────────────────────────────────────────────────────────
  if (isCCToggle) {
    const enable = lower === '!bcon';
    await kv.set(CC_ENABLED_KEY, enable);
    return { handled: true, reply: enable ? '✅ Viewer challenges enabled (!buychallenge / !bc)' : '🔒 Viewer challenges disabled' };
  }

  // ── !wallet on / !wallet off ──────────────────────────────────────────────────
  if (isWallet && (lower === '!wallet on' || lower === '!wallet off')) {
    const enabled = lower === '!wallet on';
    const stored = (await kv.get<Record<string, unknown>>(OVERLAY_SETTINGS_KEY)) ?? {};
    await kv.set(OVERLAY_SETTINGS_KEY, { ...stored, walletEnabled: enabled });
    notifyOverlay();
    return { handled: true, reply: enabled ? '💰 Wallet enabled — subs and KICKs will now update the balance' : '💰 Wallet disabled — balance paused (use !wallet on to resume)' };
  }

  // ── !challenges hide / !challenges show ───────────────────────────────────────
  if (isChallenges) {
    const visible = lower === '!challenges show';
    const stored = (await kv.get<Record<string, unknown>>(OVERLAY_SETTINGS_KEY)) ?? {};
    await kv.set(OVERLAY_SETTINGS_KEY, { ...stored, challengesVisible: visible });
    notifyOverlay();
    return { handled: true, reply: visible ? '📋 Challenges shown on overlay' : '📋 Challenges hidden from overlay' };
  }

  // ── !wallet set <amount> ── set wallet to exact balance ──────────────────────
  if (isWallet && lower.startsWith('!wallet set ')) {
    const val = parseFloat(trimmed.slice('!wallet set '.length).trim());
    if (!Number.isFinite(val) || val < 0) {
      return { handled: true, reply: 'Usage: !wallet set <amount>  e.g. !wallet set 20' };
    }
    const state = await setWalletBalance(val);
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `💰 Wallet set to ${formatUsd(state.balance)}` };
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

  // ── !spent ... ── adjust the spent total ──────────────────────────────────────
  if (isSpent) {
    const arg = trimmed.slice(lower.startsWith('!spend ') || lower === '!spend' ? '!spend'.length : '!spent'.length).trim();
    const argLower = arg.toLowerCase();

    // !spent (no args) — public, show current total
    if (arg === '') {
      const wallet = await getWallet();
      const spent = wallet.totalSpent ?? 0;
      return { handled: true, reply: `💳 Total spent this stream: ${formatUsd(spent)}` };
    }

    if (argLower === 'reset') {
      await setTotalSpent(0);
      void broadcastChallenges().catch(() => {});
      return { handled: true, reply: '✅ Spent total reset to $0' };
    }

    if (argLower.startsWith('set ')) {
      const val = parseFloat(argLower.slice(4).trim());
      if (!Number.isFinite(val) || val < 0) return { handled: true, reply: 'Usage: !spent set <amount>  e.g. !spent set 42.50' };
      await setTotalSpent(val);
      void broadcastChallenges().catch(() => {});
      return { handled: true, reply: `✅ Spent total set to ${formatUsd(val)}` };
    }

    if (argLower.startsWith('refund ')) {
      const slugForRefund = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
      if (!isModOrBroadcaster(senderPayload, sender, slugForRefund)) return { handled: true };
      const val = parseFloat(arg.slice('refund '.length).trim());
      if (!Number.isFinite(val) || val <= 0) return { handled: true, reply: 'Usage: !spent refund <amount>  e.g. !spent refund 5' };
      const walletState = await getWallet();
      const newTotalSpent = Math.max(0, Math.round(((walletState.totalSpent ?? 0) - val) * 100) / 100);
      await setTotalSpent(newTotalSpent);
      let newBalance = walletState.balance;
      if (walletEnabled) {
        const state = await addToWallet(val, { source: 'REFUND' });
        newBalance = state.balance;
      }
      void broadcastChallenges().catch(() => {});
      return {
        handled: true,
        reply: `↩️ Refunded ${formatUsd(val)} — Spent: ${formatUsd(newTotalSpent)}${walletEnabled ? ` → Wallet: ${formatUsd(newBalance)}` : ''}`,
      };
    }

    const amount = parseFloat(arg);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { handled: true, reply: 'Usage: !spent <amount>  (uses your local currency)' };
    }
    // Read stored currency from wallet state (set by wallet GET via Vercel IP header — works anywhere)
    const walletState = await getWallet();
    const currency = walletState.localCurrency ?? 'USD';
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    let usd: number;
    let localContext: { currency: string; rate: number } | undefined;
    if (walletState.localCurrency && walletState.localCurrency !== 'USD' && walletState.localRate) {
      usd = Math.round((amount / walletState.localRate) * 100) / 100;
      localContext = { currency: walletState.localCurrency, rate: walletState.localRate };
    } else {
      // USD or unknown — treat amount as USD
      usd = amount;
      localContext = undefined;
    }
    if (!Number.isFinite(usd) || usd <= 0) {
      return { handled: true, reply: `⚠️ Could not convert ${currency} to USD. Try !wallet <usd_amount> instead.` };
    }
    const currentWallet = await getWallet();
    const newTotalSpent = Math.round(((currentWallet.totalSpent ?? 0) + usd) * 100) / 100;
    await setTotalSpent(newTotalSpent);
    let newBalance = currentWallet.balance;
    if (walletEnabled) {
      const { state } = await deductFromWallet(usd, localContext);
      newBalance = state.balance;
    }
    void broadcastChallenges().catch(() => {});
    return {
      handled: true,
      reply: `💸 Spent ${symbol}${amount} ${currency} = ${formatUsd(usd)}${walletEnabled ? ` → Wallet: ${formatUsd(newBalance)}` : ''}`,
    };
  }

  // ── !challenge / !ch ... ──────────────────────────────────────────────────────
  if (!walletEnabled) return { handled: true }; // silently ignore challenge commands when wallet is off
  const cmdLen = lower.startsWith('!challenge') ? '!challenge'.length : '!ch'.length;
  const args = trimmed.slice(cmdLen).trim();
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
    const now = Date.now();
    const visible = state.challenges.filter((c) =>
      c.status === 'active' ||
      (c.status === 'timedOut' && c.resolvedAt != null && now - c.resolvedAt < 60_000)
    );
    if (visible.length === 0) return { handled: true, reply: 'No active challenges.' };
    const list = visible.map((c, i) => {
      const bounty = c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2);
      const tag = c.status === 'timedOut' ? ' [timed out]' : '';
      return `${i + 1}. $${bounty} — ${c.description}${tag}`;
    }).join(' | ');
    return { handled: true, reply: `📋 Challenges: ${list}` };
  }

  // !challenge clear
  if (argsLower === 'clear') {
    const removed = await clearResolvedChallenges();
    void broadcastChallenges().catch(() => {});
    return { handled: true, reply: `✅ Cleared ${removed} resolved challenge${removed !== 1 ? 's' : ''}` };
  }

  // !challenge done all / fail all / remove all
  if (argsLower === 'done all' || argsLower === 'fail all' || argsLower === 'remove all') {
    const action = argsLower.split(' ')[0] as 'done' | 'fail' | 'remove';
    const { challenges } = await getChallenges();
    const active = challenges.filter((c) => c.status === 'active');
    if (active.length === 0) return { handled: true, reply: 'No active challenges.' };
    await Promise.all(active.map((c) =>
      action === 'remove' ? removeChallenge(c.id) : updateChallengeStatus(c.id, action === 'done' ? 'completed' : 'failed')
    ));
    void broadcastChallenges().catch(() => {});
    const verb = action === 'done' ? 'completed' : action === 'fail' ? 'failed' : 'removed';
    const wallet = action !== 'remove' ? await getWallet() : null;
    const balNote = wallet ? ` → Wallet: ${formatUsd(wallet.balance)}` : '';
    return { handled: true, reply: `${action === 'done' ? '✅' : action === 'fail' ? '❌' : '🗑️'} ${active.length} challenge${active.length !== 1 ? 's' : ''} ${verb}${balNote}` };
  }

  // Helper: get visible challenges (active + timedOut in grace period), looked up by 1-based position
  const getVisibleByPos = async (posStr: string) => {
    const pos = parseInt(posStr, 10);
    if (!Number.isFinite(pos) || pos < 1) return { pos, target: null, error: true };
    const state = await getChallenges();
    const now = Date.now();
    const visible = state.challenges.filter((c) =>
      c.status === 'active' ||
      (c.status === 'timedOut' && c.resolvedAt != null && now - c.resolvedAt < 60_000)
    );
    return { pos, target: visible[pos - 1] ?? null, error: false };
  };

  // !challenge done <n>
  if (argsLower.startsWith('done ') || argsLower === 'done') {
    const { pos, target, error } = await getVisibleByPos(args.slice(4).trim());
    if (error) return { handled: true, reply: 'Usage: !challenge done <number>' };
    if (!target) return { handled: true, reply: `No challenge at position ${pos}.` };
    const c = await updateChallengeStatus(target.id, 'completed');
    if (!c) return { handled: true, reply: `Challenge not found.` };
    void broadcastChallenges().catch(() => {});
    const wallet = await getWallet();
    const bountyStr = c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2);
    const balStr = wallet.balance % 1 === 0 ? wallet.balance.toFixed(0) : wallet.balance.toFixed(2);
    return { handled: true, reply: `✅ Challenge ${pos} done! +$${bountyStr} → Wallet: $${balStr}` };
  }

  // !challenge fail <n>
  if (argsLower.startsWith('fail ') || argsLower === 'fail') {
    const { pos, target, error } = await getVisibleByPos(args.slice(4).trim());
    if (error) return { handled: true, reply: 'Usage: !challenge fail <number>' };
    if (!target) return { handled: true, reply: `No challenge at position ${pos}.` };
    const c = await updateChallengeStatus(target.id, 'failed');
    if (!c) return { handled: true, reply: `Challenge not found.` };
    void broadcastChallenges().catch(() => {});
    const bountyStr = c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2);
    return { handled: true, reply: `❌ Challenge ${pos} failed ($${bountyStr} — ${c.description})` };
  }

  // !challenge remove <n>
  if (argsLower.startsWith('remove ') || argsLower === 'remove') {
    const { pos, target, error } = await getVisibleByPos(args.slice(6).trim());
    if (error) return { handled: true, reply: 'Usage: !challenge remove <number>' };
    if (!target) return { handled: true, reply: `No challenge at position ${pos}.` };
    const removed = await removeChallenge(target.id);
    if (!removed) return { handled: true, reply: `Challenge not found.` };
    if (removed.buyerUsername) {
      void addCredits(removed.buyerUsername, 1000, { skipExclusions: true }).catch(() => {});
    }
    void broadcastChallenges().catch(() => {});
    const refundNote = removed.buyerUsername ? ` (1,000 Credits refunded to @${removed.buyerUsername})` : '';
    return { handled: true, reply: `🗑️ Challenge ${pos} removed${refundNote}` };
  }

  // !challenge steps / !challenge fitness / !challenge social — random tiered challenge
  if (argsLower === 'steps' || argsLower === 'fitness' || argsLower === 'social') {
    const state = await getChallenges();
    const activeCount = state.challenges.filter((c) => c.status === 'active').length;
    if (activeCount >= 5) return { handled: true, reply: '⚠️ Max 5 active challenges reached. Complete or fail some first.' };
    let item;
    if (argsLower === 'steps') {
      const { getWellnessData } = await import('@/utils/wellness-storage');
      const wellness = await getWellnessData();
      const c = await makeMovementChallenge(wellness?.steps ?? 0);
      item = await addChallenge(c.bounty, c.description, c.expiresAt, c.opts);
    } else if (argsLower === 'fitness') {
      const c = makeFitnessChallenge();
      item = await addChallenge(c.bounty, c.description, c.expiresAt);
    } else {
      const c = makeSocialChallenge();
      item = await addChallenge(c.bounty, c.description, c.expiresAt);
    }
    if (!item) return { handled: true, reply: '⚠️ Max 5 active challenges reached.' };
    void broadcastChallenges().catch(() => {});
    const timerNote = item.expiresAt ? ' ⏱ timed' : '';
    const bountyStr = item.bounty % 1 === 0 ? item.bounty.toFixed(0) : item.bounty.toFixed(2);
    return { handled: true, reply: `📋 Challenge added: $${bountyStr}${timerNote} — ${item.description}` };
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
  if (!item) return { handled: true, reply: '⚠️ Max 5 active challenges reached. Complete or fail some first.' };
  void broadcastChallenges().catch(() => {});
  const timerSuffix = expiresAt ? ` (${parts[descStart - 1]} to complete)` : '';
  return {
    handled: true,
    reply: `📋 Challenge #${item.id} added: $${item.bounty} — ${item.description}${timerSuffix}`,
  };
}
