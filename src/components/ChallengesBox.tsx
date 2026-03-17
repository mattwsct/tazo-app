'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OverlayState } from '@/types/settings';
import { NO_DECIMAL_CURRENCIES } from '@/utils/convert-utils';

const CB_CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',   AUD: 'A$',  CAD: 'C$',  NZD: 'NZ$', SGD: 'S$',  HKD: 'HK$',
  EUR: '€',   GBP: '£',   JPY: '¥',   CNY: '¥',   KRW: '₩',   INR: '₹',
  BRL: 'R$',  CHF: 'Fr',  THB: '฿',   PHP: '₱',   IDR: 'Rp',  MYR: 'RM',
  VND: '₫',   TWD: 'NT$', ZAR: 'R',   TRY: '₺',   PLN: 'zł',  ILS: '₪',
  AED: 'د.إ', RUB: '₽',   UAH: '₴',   NGN: '₦',   KES: 'KSh', EGP: 'E£',
  PKR: '₨',   GHS: 'GH₵',
};
const CB_AMBIGUOUS = new Set(['SEK', 'NOK', 'DKK', 'MXN', 'ARS', 'CLP', 'COP', 'CZK', 'HUF', 'RON', 'SAR']);

// NO_DECIMAL_CURRENCIES is imported from convert-utils (canonical definition)

function cbFmtLocal(amountUsd: number, currency: string, rate: number): string {
  const sym = CB_AMBIGUOUS.has(currency) ? null : (CB_CURRENCY_SYMBOLS[currency] ?? null);
  const local = amountUsd * rate;
  let str: string;
  if (NO_DECIMAL_CURRENCIES.has(currency)) {
    str = Math.round(local).toLocaleString();
  } else {
    const dec = Math.round(local * 100) / 100;
    str = dec % 1 === 0 ? dec.toLocaleString() : dec.toFixed(2);
  }
  return sym ? `${sym}${str}` : `${str} ${currency}`;
}

function cbFmtLocalExact(amount: number, currency: string): string {
  const sym = CB_AMBIGUOUS.has(currency) ? null : (CB_CURRENCY_SYMBOLS[currency] ?? null);
  let str: string;
  if (NO_DECIMAL_CURRENCIES.has(currency)) {
    str = Math.round(amount).toLocaleString();
  } else {
    const dec = Math.round(amount * 100) / 100;
    str = dec % 1 === 0 ? dec.toLocaleString() : dec.toFixed(2);
  }
  return sym ? `${sym}${str}` : `${str} ${currency}`;
}

const TIMER_COMPLETE_DISPLAY_MS = 10000;
const WALLET_ANIM_DURATION_MS = 2500;
const ALERT_DISPLAY_MS = 10000;
const GOALS_CYCLE_DURATION_MS = 10000;
const CROSSFADE_DURATION_MS = 400;

type GoalSlide = 'subs' | 'kicks';
type OverlayAlert = { id: string; type: string; username: string; extra?: string; at: number };

const ALERT_LABELS: Record<string, string> = {
  sub: '🎉 New Sub',
  resub: '💪 Resub',
  giftSub: '🎁 Gift Subs',
  kicks: '💚 Kicks',
};

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ChallengesBox({
  settings,
  now,
}: {
  settings: OverlayState;
  now: number;
}) {
  // ── Goals + alerts ─────────────────────────────────────────────────────────
  const showGoalsRotation = settings.showGoalsRotation !== false;
  const overlayAlerts = useMemo(() => settings.overlayAlerts ?? [], [settings.overlayAlerts]);
  const showOverlayAlerts = settings.showOverlayAlerts !== false;

  const subTarget = Math.max(1, settings.subGoalTarget ?? 10);
  const kicksTarget = Math.max(1, settings.kicksGoalTarget ?? 5000);
  const showSubGoal = !!(settings.showSubGoal);
  const showKicksGoal = !!(settings.showKicksGoal);
  const streamGoals = settings.streamGoals ?? { subs: 0, kicks: 0 };

  const goalSlides = (['subs', 'kicks'] as GoalSlide[]).filter((s) =>
    s === 'subs' ? showSubGoal : showKicksGoal
  );
  const goalSlidesKey = goalSlides.join(',');
  const goalSlidesRef = useRef<GoalSlide[]>(goalSlides);
  useEffect(() => { goalSlidesRef.current = goalSlides; }, [goalSlides, goalSlidesKey]);

  const [activeGoal, setActiveGoal] = useState<GoalSlide | null>(goalSlides[0] ?? null);
  const [displayedGoal, setDisplayedGoal] = useState<GoalSlide | null>(goalSlides[0] ?? null);
  const [displayedGoalKey, setDisplayedGoalKey] = useState(0);
  const goalHoldUntilRef = useRef<number>(0);
  const goalTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastSeenAlertIdsRef = useRef<Set<string>>(new Set());
  const subsAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kicksAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [subsAlert, setSubsAlert] = useState<OverlayAlert | null>(null);
  const [kicksAlert, setKicksAlert] = useState<OverlayAlert | null>(null);

  // Sync when enabled goals change
  useEffect(() => {
    if (goalSlides.length === 0) {
      setActiveGoal(null); setDisplayedGoal(null); return;
    }
    if (activeGoal && goalSlides.includes(activeGoal)) return;
    setActiveGoal(goalSlides[0]); setDisplayedGoal(goalSlides[0]); setDisplayedGoalKey((k) => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalSlidesKey]);

  // Crossfade after goal transition delay
  useEffect(() => {
    if (activeGoal == null) return;
    if (activeGoal === displayedGoal) return;
    if (goalTransitionRef.current) clearTimeout(goalTransitionRef.current);
    goalTransitionRef.current = setTimeout(() => {
      goalTransitionRef.current = null;
      setDisplayedGoal(activeGoal);
      setDisplayedGoalKey((k) => k + 1);
    }, CROSSFADE_DURATION_MS);
    return () => { if (goalTransitionRef.current) clearTimeout(goalTransitionRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoal]);

  // Alert bumping
  useEffect(() => {
    if (!showOverlayAlerts || overlayAlerts.length === 0) return;
    const seen = lastSeenAlertIdsRef.current;
    for (const a of overlayAlerts) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);
      const isSubType = a.type === 'sub' || a.type === 'resub' || a.type === 'giftSub';
      const isKicksType = a.type === 'kicks';
      if (isSubType) {
        goalHoldUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveGoal('subs');
          setSubsAlert(a);
        });
        if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
        subsAlertClearRef.current = setTimeout(() => { subsAlertClearRef.current = null; setSubsAlert(null); }, ALERT_DISPLAY_MS);
        break;
      }
      if (isKicksType) {
        goalHoldUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveGoal('kicks');
          setKicksAlert(a);
        });
        if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
        kicksAlertClearRef.current = setTimeout(() => { kicksAlertClearRef.current = null; setKicksAlert(null); }, ALERT_DISPLAY_MS);
        break;
      }
    }
  }, [overlayAlerts, showOverlayAlerts, showGoalsRotation]);

  // Goals cycling
  useEffect(() => {
    if (!showGoalsRotation || goalSlides.length <= 1) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (Date.now() < goalHoldUntilRef.current) return;
      const current = goalSlidesRef.current;
      if (current.length <= 1) return;
      setActiveGoal((prev) => {
        const idx = prev && current.includes(prev) ? current.indexOf(prev) : 0;
        return current[(idx + 1) % current.length];
      });
    };
    const schedule = () => {
      const msUntilNext = GOALS_CYCLE_DURATION_MS - (Date.now() % GOALS_CYCLE_DURATION_MS);
      timeoutId = setTimeout(() => { tick(); schedule(); }, msUntilNext);
    };
    schedule();
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [showGoalsRotation, goalSlides.length, goalSlidesKey]);

  // Cleanup alert timers
  useEffect(() => {
    return () => {
      if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
      if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
    };
  }, []);

  const hasGoalsContent = showGoalsRotation && goalSlides.length > 0;
  const hasGoalAlertOnly = !hasGoalsContent && (subsAlert != null || kicksAlert != null);
  const hasGoalSection = hasGoalsContent || hasGoalAlertOnly;

  // ── Global timer ───────────────────────────────────────────────────────────
  const timerStateRaw = settings.timerState;
  const timerState = Array.isArray(timerStateRaw) ? (timerStateRaw[0] ?? null) : (timerStateRaw ?? null);
  const timerRemainingMs = timerState ? Math.max(0, timerState.endsAt - now) : 0;
  const [timerCompleteUntil, setTimerCompleteUntil] = useState<number | null>(null);
  const timerCompletionStartedForRef = useRef<number | null>(null);

  useEffect(() => {
    if (!timerState) { timerCompletionStartedForRef.current = null; setTimerCompleteUntil(null); return; }
    if (timerRemainingMs > 0) return;
    if (timerCompletionStartedForRef.current === timerState.endsAt) return;
    timerCompletionStartedForRef.current = timerState.endsAt;
    setTimerCompleteUntil(Date.now() + TIMER_COMPLETE_DISPLAY_MS);
    fetch(`/api/timer-end-trigger?endsAt=${timerState.endsAt}`, { cache: 'no-store' }).catch(() => {});
  }, [timerState, timerRemainingMs]);

  const isTimerCompletePhase =
    !!timerState && timerRemainingMs <= 0 && timerCompleteUntil != null && now < timerCompleteUntil;
  const hasTimer = !!timerState && (timerRemainingMs > 0 || isTimerCompletePhase);

  // ── Wallet ─────────────────────────────────────────────────────────────────
  const wallet = settings.walletState;
  const walletEnabled = settings.walletEnabled;
  const showWallet = walletEnabled && wallet != null;

  const [walletAnim, setWalletAnim] = useState<string | null>(null);
  const lastWalletUpdatedAtRef = useRef<number | null>(null);
  const walletAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!wallet) return;
    const prev = lastWalletUpdatedAtRef.current;
    lastWalletUpdatedAtRef.current = wallet.updatedAt;
    if (prev === null || prev === wallet.updatedAt) return;
    const change = wallet.lastChangeUsd;
    if (change === undefined || change === 0) return;
    const sign = change > 0 ? '+' : '-';
    const exactLocal = wallet.lastChangeLocalAmount;
    const localRate = wallet.localRate;
    const localCurrency = wallet.localCurrency;
    const absStr = localRate && localCurrency
      ? exactLocal != null
        ? cbFmtLocalExact(Math.abs(exactLocal), localCurrency)
        : cbFmtLocal(Math.abs(change), localCurrency, localRate)
      : `$${Math.abs(change).toFixed(2)}`;
    const source = wallet.lastChangeSource;
    const label = source ? `${source} ${sign}${absStr}` : `${sign}${absStr}`;
    setWalletAnim(label);
    if (walletAnimTimerRef.current) clearTimeout(walletAnimTimerRef.current);
    walletAnimTimerRef.current = setTimeout(() => setWalletAnim(null), WALLET_ANIM_DURATION_MS);
  }, [wallet]);

  const localAmount =
    wallet?.localCurrency && wallet?.localRate
      ? Math.round(wallet.balance * wallet.localRate * 10) / 10
      : null;

  // ── Challenges ─────────────────────────────────────────────────────────────
  const challenges = settings.challengesState?.challenges ?? [];
  const activeChallenges = challenges.filter((c) => c.status === 'active');

  const hasContent = hasGoalSection || hasTimer || activeChallenges.length > 0 || showWallet;
  if (!hasContent) return null;

  // ── Goal row renderer ──────────────────────────────────────────────────────
  const renderGoalRow = (type: GoalSlide, keyExtra?: string) => {
    const isSubs = type === 'subs';
    const current = isSubs ? streamGoals.subs : streamGoals.kicks;
    const target = isSubs ? subTarget : kicksTarget;
    const alert = isSubs ? subsAlert : kicksAlert;
    const pct = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
    const subtext = isSubs ? settings.subGoalSubtext : settings.kicksGoalSubtext;
    const fillStyle = isSubs
      ? 'linear-gradient(90deg, rgba(139, 92, 246, 0.28) 0%, rgba(168, 85, 247, 0.38) 100%)'
      : 'linear-gradient(90deg, rgba(16, 185, 129, 0.28) 0%, rgba(52, 211, 153, 0.38) 100%)';
    const alertFillStyle = isSubs
      ? 'linear-gradient(90deg, rgba(139, 92, 246, 0.45) 0%, rgba(168, 85, 247, 0.55) 100%)'
      : 'linear-gradient(90deg, rgba(16, 185, 129, 0.45) 0%, rgba(52, 211, 153, 0.55) 100%)';

    if (alert) {
      const alertLabel = ALERT_LABELS[alert.type] ?? alert.type;
      const username = alert.username.replace(/^@+/, '');
      const extra = alert.extra;
      return (
        <div key={`alert-${type}-${keyExtra ?? ''}`} className="challenges-goal-row challenges-goal-row--alert">
          <div className="challenges-goal-fill" style={{ width: '100%', background: alertFillStyle }} />
          <div className="challenges-goal-alert-content">
            <span className="challenges-goal-alert-label">{alertLabel}</span>
            <span className="challenges-goal-alert-username">
              {username}{extra ? ` — ${extra}` : ''}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div key={`goal-${type}-${keyExtra ?? ''}`} className="challenges-goal-row">
        <div className="challenges-goal-fill" style={{ width: `${pct}%`, background: fillStyle }} />
        <span className="challenges-goal-label">{isSubs ? 'SUBS' : 'KICKS'}</span>
        <div className="challenges-goal-right">
          <span className="challenges-goal-value">
            {isSubs ? `${current} / ${target}` : `${current.toLocaleString()} / ${target.toLocaleString()}`}
          </span>
          {subtext && subtext.trim() && (
            <span className="challenges-goal-subtext">{subtext.trim()}</span>
          )}
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const timerLabel = timerState?.title || 'TIMER';
  const timerTimeStr = isTimerCompletePhase ? "Time's up!" : formatMs(timerRemainingMs);

  return (
    <div className="challenges-box">
      {/* Goal / alert section */}
      {hasGoalSection && (
        <div className="challenges-goals-section">
          {hasGoalsContent ? (
            <div key={`${displayedGoal}-${displayedGoalKey}`} className="challenges-goal-slide">
              {renderGoalRow((displayedGoal ?? activeGoal ?? goalSlides[0])!)}
            </div>
          ) : (
            <>
              {subsAlert && renderGoalRow('subs')}
              {kicksAlert && renderGoalRow('kicks')}
            </>
          )}
        </div>
      )}

      {/* Wallet header */}
      {showWallet && (
        <div className="challenges-header">
          <span className="challenges-header-label">WALLET</span>
          <div className="challenges-header-right">
            {walletAnim ? (
              <span className="challenges-wallet-anim">{walletAnim}</span>
            ) : localAmount !== null ? (
              <>
                <span className="challenges-header-value">≈ {cbFmtLocal(wallet!.balance, wallet!.localCurrency!, wallet!.localRate!)}</span>
                <span className="challenges-header-local">{wallet!.balance % 1 === 0 ? `$${wallet!.balance.toFixed(0)}` : `$${wallet!.balance.toFixed(2)}`}</span>
              </>
            ) : (
              <span className="challenges-header-value">{wallet!.balance % 1 === 0 ? `$${wallet!.balance.toFixed(0)}` : `$${wallet!.balance.toFixed(2)}`}</span>
            )}
          </div>
        </div>
      )}

      {/* Global timer */}
      {hasTimer && (
        <div className={`challenges-timer-row${isTimerCompletePhase ? ' challenges-timer-done' : ''}`}>
          <span className="challenges-timer-label">{timerLabel}</span>
          <span className="challenges-timer-value">{timerTimeStr}</span>
        </div>
      )}

      {/* Active challenges */}
      {activeChallenges.length > 0 && (
        <div className="challenges-list">
          <div className="challenges-list-header">CHALLENGES</div>
          {activeChallenges.map((c, i) => {
            const hasExpiry = !!c.expiresAt;
            const expiryMs = hasExpiry ? Math.max(0, c.expiresAt! - now) : null;
            const isUrgent = expiryMs !== null && expiryMs < 60_000;
            return (
              <div key={c.id} className={`challenge-item${isUrgent ? ' challenge-item--urgent' : ''}`}>
                <span className="challenge-num">{i + 1}.</span>
                <span className="challenge-bounty">
                  ${c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2)}
                </span>
                <span className="challenge-desc">{c.description}</span>
                {expiryMs !== null && (
                  <span className={`challenge-expiry${isUrgent ? ' challenge-expiry--urgent' : ''}`}>
                    {formatMs(expiryMs)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
