'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OverlayState } from '@/types/settings';
import type { OverlayTimerState } from '@/types/timer';
import { filterTextForDisplay } from '@/lib/poll-content-filter';

const TIMER_COMPLETE_DISPLAY_MS = 10000;

function fmtUsd(v: number): string {
  return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$',
  EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩', INR: '₹',
  BRL: 'R$', MXN: '$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  THB: '฿', PHP: '₱', IDR: 'Rp', MYR: 'RM', VND: '₫', TWD: 'NT$',
  ZAR: 'R', TRY: '₺', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei',
  ILS: '₪', AED: 'د.إ', SAR: '﷼', RUB: '₽', UAH: '₴', NGN: '₦',
  KES: 'KSh', GHS: 'GH₵', ARS: '$', CLP: '$', COP: '$', EGP: 'E£',
  PKR: '₨',
};

function fmtLocal(amountUsd: number, currency: string, rate: number): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? '';
  const local = Math.round(amountUsd * rate);
  return `${sym}${local.toLocaleString()} ${currency}`;
}

function fmtUsdInline(v: number): string {
  return `~$${Math.round(v).toLocaleString()} USD`;
}
const ALERT_DISPLAY_MS = 10000;

type OverlayAlert = { id: string; type: string; username: string; extra?: string; at: number };

const ALERT_LABELS: Record<string, string> = {
  sub: '🎉 New Sub',
  resub: '💪 Resub',
  giftSub: '🎁 Gift Sub',
  kicks: '💚 KICKs',
};

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '00')}`;
}

function TimerRow({ timer, now }: { timer: OverlayTimerState; now: number }) {
  const remainingMs = Math.max(0, timer.endsAt - now);
  const [completeUntil, setCompleteUntil] = useState<number | null>(null);
  const startedForRef = useRef<number | null>(null);

  useEffect(() => {
    if (remainingMs > 0) return;
    if (startedForRef.current === timer.endsAt) return;
    startedForRef.current = timer.endsAt;
    if (Date.now() - timer.endsAt > TIMER_COMPLETE_DISPLAY_MS) return;
    queueMicrotask(() => setCompleteUntil(Date.now() + TIMER_COMPLETE_DISPLAY_MS));
    fetch(`/api/timer-end-trigger?endsAt=${timer.endsAt}`, { cache: 'no-store' }).catch(() => {});
  }, [remainingMs, timer.endsAt]);

  const isDone = remainingMs <= 0 && completeUntil != null && now < completeUntil;
  if (!isDone && remainingMs <= 0) return null;

  return (
    <div className={`sp-row sp-timer-row${isDone ? ' sp-timer-done' : ''}`}>
      <span className="sp-label">{timer.title ?? ''}</span>
      <span className="sp-timer-value">{isDone ? "Time's up!" : formatMs(remainingMs)}</span>
    </div>
  );
}

// Poll option fill colours (cycles through options)
const POLL_FILL_COLORS = [
  'rgba(99, 179, 237, 0.35)',   // blue
  'rgba(154, 117, 234, 0.35)',  // purple
  'rgba(52, 211, 153, 0.35)',   // green
  'rgba(251, 191, 36, 0.35)',   // amber
  'rgba(248, 113, 113, 0.35)',  // red
];
const POLL_FILL_WINNER_COLORS = [
  'rgba(99, 179, 237, 0.55)',
  'rgba(154, 117, 234, 0.55)',
  'rgba(52, 211, 153, 0.55)',
  'rgba(251, 191, 36, 0.55)',
  'rgba(248, 113, 113, 0.55)',
];

export default function StreamPanel({
  settings,
  now,
}: {
  settings: OverlayState;
  now: number;
}) {
  // ── Alerts ─────────────────────────────────────────────────────────────────
  const overlayAlerts = useMemo(() => settings.overlayAlerts ?? [], [settings.overlayAlerts]);
  const showOverlayAlerts = settings.showOverlayAlerts !== false;
  const lastSeenAlertIdsRef = useRef<Set<string>>(new Set());
  const subsAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kicksAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subsAlert, setSubsAlert] = useState<OverlayAlert | null>(null);
  const [kicksAlert, setKicksAlert] = useState<OverlayAlert | null>(null);

  useEffect(() => {
    if (!showOverlayAlerts || overlayAlerts.length === 0) return;
    const seen = lastSeenAlertIdsRef.current;
    for (const a of overlayAlerts) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);
      const isSubType = a.type === 'sub' || a.type === 'resub' || a.type === 'giftSub';
      const isKicksType = a.type === 'kicks';
      if (isSubType) {
        setSubsAlert(a);
        if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
        subsAlertClearRef.current = setTimeout(() => { subsAlertClearRef.current = null; setSubsAlert(null); }, ALERT_DISPLAY_MS);
        break;
      }
      if (isKicksType) {
        setKicksAlert(a);
        if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
        kicksAlertClearRef.current = setTimeout(() => { kicksAlertClearRef.current = null; setKicksAlert(null); }, ALERT_DISPLAY_MS);
        break;
      }
    }
  }, [overlayAlerts, showOverlayAlerts]);

  useEffect(() => {
    return () => {
      if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
      if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
      if (walletAnimTimerRef.current) clearTimeout(walletAnimTimerRef.current);
      walletAnimQueueRef.current = [];
    };
  }, []);

  // ── Goals ──────────────────────────────────────────────────────────────────
  const subTarget = Math.max(1, settings.subGoalTarget ?? 10);
  const kicksTarget = Math.max(1, settings.kicksGoalTarget ?? 5000);
  const showSubGoal = !!(settings.showSubGoal);
  const showKicksGoal = !!(settings.showKicksGoal);
  const streamGoals = settings.streamGoals ?? { subs: 0, kicks: 0 };
  const showSubsRow = showSubGoal;
  const showKicksRow = showKicksGoal;
  const hasGoalSection = showSubsRow || showKicksRow;

  // ── Timers ─────────────────────────────────────────────────────────────────
  const timerStates: OverlayTimerState[] = Array.isArray(settings.timerState)
    ? settings.timerState
    : settings.timerState ? [settings.timerState] : [];

  // ── Wallet ─────────────────────────────────────────────────────────────────
  const wallet = settings.walletState;
  const showWallet = !!(settings.walletEnabled && (settings.walletVisible !== false) && wallet);

  const [walletAnim, setWalletAnim] = useState<{ label: string; negative: boolean } | null>(null);
  const lastWalletUpdatedAtRef = useRef<number | null>(null);
  const walletAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletAnimQueueRef = useRef<Array<{ label: string; negative: boolean }>>([]);
  const advanceWalletAnimRef = useRef<() => void>(() => {});
  advanceWalletAnimRef.current = () => {
    const next = walletAnimQueueRef.current.shift();
    if (next) {
      setWalletAnim(next);
      // eslint-disable-next-line react-hooks/immutability
      walletAnimTimerRef.current = setTimeout(advanceWalletAnimRef.current, ALERT_DISPLAY_MS);
    } else {
      setWalletAnim(null);
      walletAnimTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!wallet) return;
    const prev = lastWalletUpdatedAtRef.current;
    lastWalletUpdatedAtRef.current = wallet.updatedAt;
    if (prev === null || prev === wallet.updatedAt) return;
    const change = wallet.lastChangeUsd;
    if (change === undefined || change === 0) return;
    const sign = change > 0 ? '+' : '-';
    const localRate = wallet.localRate;
    const localCurrency = wallet.localCurrency;
    const sym = localCurrency ? (CURRENCY_SYMBOLS[localCurrency] ?? '') : '';
    // Use exact stored local amount (e.g. Wise card spend) to avoid USD round-trip imprecision
    const exactLocal = wallet.lastChangeLocalAmount;
    const absStr = localRate && localCurrency
      ? exactLocal != null
        ? `${sym}${Math.abs(exactLocal) % 1 === 0 ? Math.abs(exactLocal).toLocaleString() : Math.abs(exactLocal).toFixed(2)} ${localCurrency}`
        : `${sym}${Math.round(Math.abs(change) * localRate).toLocaleString()} ${localCurrency}`
      : fmtUsd(Math.abs(change));
    const source = wallet.lastChangeSource;
    const label = source ? `${source} ${sign}${absStr}` : `${sign}${absStr}`;
    const anim = { label, negative: change < 0 };
    if (walletAnimTimerRef.current !== null) {
      walletAnimQueueRef.current.push(anim);
    } else {
      setWalletAnim(anim);
      // eslint-disable-next-line react-hooks/immutability
      walletAnimTimerRef.current = setTimeout(advanceWalletAnimRef.current, ALERT_DISPLAY_MS);
    }
  }, [wallet]);

  const localAmount =
    wallet?.localCurrency && wallet?.localRate
      ? Math.round(wallet.balance * wallet.localRate)
      : null;

  // ── Challenges ─────────────────────────────────────────────────────────────
  const challenges = settings.challengesState?.challenges ?? [];
  const challengesVisible = settings.challengesVisible !== false;
  const activeChallenges = challengesVisible ? challenges
    .filter((c) => c.status === 'active' || c.status === 'timedOut')
    .sort((a, b) => b.bounty - a.bounty)
  : [];

  // ── Poll ───────────────────────────────────────────────────────────────────
  const poll = settings.pollState ?? null;
  const pollTotalVotes = poll ? poll.options.reduce((s, o) => s + o.votes, 0) : 0;
  const isPollActive =
    !!poll &&
    (poll.status === 'active' ||
      (poll.status === 'winner' && poll.winnerDisplayUntil != null && now < poll.winnerDisplayUntil && pollTotalVotes > 0));

  // ── Trivia ─────────────────────────────────────────────────────────────────
  const trivia = settings.triviaState ?? null;
  const isTriviaActive =
    !isPollActive &&
    !!trivia &&
    (!trivia.winnerDisplayUntil || now < trivia.winnerDisplayUntil);

  const hasPollOrTrivia = isPollActive || isTriviaActive;

  // ── Visibility ─────────────────────────────────────────────────────────────
  const hasMainContent = hasGoalSection || showWallet || timerStates.length > 0 || activeChallenges.length > 0;
  if (!hasMainContent && !hasPollOrTrivia) return null;

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderGoalRow = (type: 'subs' | 'kicks') => {
    const isSubs = type === 'subs';
    const alert = isSubs ? subsAlert : kicksAlert;
    const fillColor = isSubs
      ? 'linear-gradient(90deg, rgba(139, 92, 246, 0.38) 0%, rgba(139, 92, 246, 0.12) 100%)'
      : 'linear-gradient(90deg, rgba(16, 185, 129, 0.38) 0%, rgba(16, 185, 129, 0.12) 100%)';
    const alertBg = isSubs ? 'rgba(139, 92, 246, 0.18)' : 'rgba(16, 185, 129, 0.16)';
    const alertBorder = isSubs ? 'rgba(168, 85, 247, 0.55)' : 'rgba(52, 211, 153, 0.55)';

    if (alert) {
      const alertLabel = alert.type === 'giftSub' && alert.extra !== '1 sub'
        ? '🎁 Gift Subs'
        : (ALERT_LABELS[alert.type] ?? alert.type);
      const username = alert.username.replace(/^@+/, '');
      const extra = alert.extra;
      return (
        <div
          key={`alert-${type}`}
          className="sp-goal-row sp-goal-row--alert"
          style={{ background: alertBg, borderLeft: `3px solid ${alertBorder}` }}
        >
          <span className="sp-label">{alertLabel}</span>
          <span className="sp-goal-alert-username">
            {username}{extra ? ` — ${extra}` : ''}
          </span>
        </div>
      );
    }

    const current = isSubs ? streamGoals.subs : streamGoals.kicks;
    const target = isSubs ? subTarget : kicksTarget;
    const pct = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
    const subtext = isSubs ? settings.subGoalSubtext : settings.kicksGoalSubtext;

    return (
      <div key={type} className="sp-goal-row">
        <div className="sp-goal-fill" style={{ width: `${pct}%`, background: fillColor }} />
        <span className="sp-label">{isSubs ? 'SUBS' : 'KICKS'}</span>
        <div className="sp-right-stack">
          <span className="sp-goal-value">
            {isSubs
              ? `${current} / ${target}`
              : `${current.toLocaleString()} / ${target.toLocaleString()}`}
          </span>
          {subtext?.trim() && <span className="sp-goal-subtext">{subtext.trim()}</span>}
        </div>
      </div>
    );
  };

  const renderPoll = () => {
    if (!poll) return null;
    const isWinner = poll.status === 'winner';
    const totalVotes = poll.options.reduce((s, o) => s + o.votes, 0);
    const maxVotes = Math.max(0, ...poll.options.map((o) => o.votes));
    const timerPct = poll.status === 'active'
      ? Math.max(0, Math.min(100, ((poll.startedAt + poll.durationSeconds * 1000 - now) / (poll.durationSeconds * 1000)) * 100))
      : 0;

    const optionsToShow = isWinner
      ? [...poll.options].sort((a, b) => b.votes - a.votes).filter((o) => o.votes === maxVotes && maxVotes > 0)
      : [...poll.options].sort((a, b) => b.votes - a.votes);

    return (
      <div className="sp-bottom-section">
        <div className="sp-bottom-header">
          <span className="sp-section-label">POLL</span>
          <span className="sp-bottom-question">{filterTextForDisplay(poll.question)}</span>
        </div>
        {poll.status === 'active' && (
          <div className="sp-poll-timer">
            <div className="sp-poll-timer-fill" style={{ width: `${timerPct}%` }} />
          </div>
        )}
        <div className="sp-poll-options">
          {optionsToShow.map((opt, i) => {
            const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
            const displayPct = isWinner ? 100 : pct;
            const fillColor = isWinner ? POLL_FILL_WINNER_COLORS[i % POLL_FILL_WINNER_COLORS.length] : POLL_FILL_COLORS[i % POLL_FILL_COLORS.length];
            const voteLabel = isWinner
              ? `${opt.votes} vote${opt.votes !== 1 ? 's' : ''}`
              : `${pct}%`;
            return (
              <div key={opt.label} className={`sp-poll-option${isWinner ? ' sp-poll-option--winner' : ''}`}>
                <div className="sp-goal-fill" style={{ width: `${displayPct}%`, background: fillColor }} />
                <span className="sp-poll-option-label">{filterTextForDisplay(opt.label)}</span>
                <span className="sp-poll-option-votes">{voteLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTrivia = () => {
    if (!trivia) return null;
    const isWinner = !!trivia.winnerUsername;
    return (
      <div className="sp-bottom-section">
        <div className="sp-bottom-header">
          <span className="sp-section-label">TRIVIA</span>
          <span className="sp-bottom-question">{filterTextForDisplay(trivia.question)}</span>
        </div>
        {isWinner ? (
          <div className="sp-trivia-winner">
            <span className="sp-trivia-winner-name">{filterTextForDisplay(trivia.winnerUsername!)}</span>
            <span className="sp-trivia-winner-answer">
              {filterTextForDisplay(trivia.winnerAnswer ?? '')}
              {trivia.winnerPoints != null ? ` — ${trivia.winnerPoints} Credits` : ''}
            </span>
          </div>
        ) : (
          <div className="sp-trivia-reward">
            First correct answer wins {trivia.points} Credits
          </div>
        )}
      </div>
    );
  };

  const renderChallenges = () => (
    activeChallenges.length > 0 ? (
      <div className="sp-bottom-section">
        <div className="sp-bottom-header sp-bottom-header--challenges">
          <span className="sp-section-label">CHALLENGES</span>
        </div>
        {activeChallenges.map((c, i) => {
          const isTimedOut = c.status === 'timedOut' || (c.expiresAt != null && c.expiresAt <= now);
          const expiryMs = !isTimedOut && c.expiresAt ? Math.max(0, c.expiresAt - now) : null;
          const isUrgent = expiryMs !== null && expiryMs < 60_000;
          const bountyDisplay = `${fmtUsd(c.bounty)} USD`;
          return (
            <div key={c.id} className={`sp-challenge-item${isUrgent ? ' sp-challenge-item--urgent' : ''}${isTimedOut ? ' sp-challenge-item--timeout' : ''}`}>
              <span className="sp-challenge-num">{i + 1}.</span>
              <span className="sp-challenge-bounty">{bountyDisplay}</span>
              <span className="sp-challenge-desc">{c.description}</span>
              {expiryMs !== null && (
                <span className={`sp-challenge-expiry${isUrgent ? ' sp-challenge-expiry--urgent' : ''}`}>
                  {formatMs(expiryMs)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    ) : null
  );

  return (
    <>
      {/* Main panel: goals, wallet, timer, challenges */}
      {hasMainContent && (
        <div className="stream-panel">
          {/* Goals / alerts */}
          {hasGoalSection && (
            <div className="sp-goals-section">
              {showSubsRow && renderGoalRow('subs')}
              {showKicksRow && renderGoalRow('kicks')}
            </div>
          )}

          {/* Timers */}
          {timerStates.map((t) => (
            <TimerRow key={t.createdAt} timer={t} now={now} />
          ))}

          {/* Wallet */}
          {showWallet && (
            <div className="sp-row sp-wallet-row">
              <span className="sp-label">WALLET</span>
              <div className="sp-right-stack">
                {walletAnim ? (
                  <span className={`sp-wallet-anim${walletAnim.negative ? ' sp-wallet-anim--negative' : ''}`}>{walletAnim.label}</span>
                ) : localAmount !== null ? (
                  <>
                    <span className="sp-wallet-value">{fmtLocal(wallet!.balance, wallet!.localCurrency!, wallet!.localRate!)}</span>
                    <span className="sp-wallet-usd">{fmtUsd(wallet!.balance)} USD</span>
                  </>
                ) : (
                  <span className="sp-wallet-value">{fmtUsd(wallet!.balance)} USD</span>
                )}
              </div>
            </div>
          )}

          {/* Challenges always shown here, not rotated */}
          {renderChallenges()}
        </div>
      )}

      {/* Poll/trivia — separate box below */}
      {isPollActive && (
        <div className="stream-panel sp-panel-secondary">
          {renderPoll()}
        </div>
      )}
      {isTriviaActive && (
        <div className="stream-panel sp-panel-secondary">
          {renderTrivia()}
        </div>
      )}
    </>
  );
}
