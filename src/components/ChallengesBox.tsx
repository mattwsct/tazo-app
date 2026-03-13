'use client';

import { useState, useEffect, useRef } from 'react';
import type { OverlayState } from '@/types/settings';

const TIMER_COMPLETE_DISPLAY_MS = 10000;

export default function ChallengesBox({
  settings,
  now,
}: {
  settings: OverlayState;
  now: number;
}) {
  const timerState = settings.timerState ?? null;
  const remainingMs = timerState ? Math.max(0, timerState.endsAt - now) : 0;
  const [timerCompleteUntil, setTimerCompleteUntil] = useState<number | null>(null);
  const timerCompletionStartedForRef = useRef<number | null>(null);

  useEffect(() => {
    if (!timerState) {
      timerCompletionStartedForRef.current = null;
      setTimerCompleteUntil(null);
      return;
    }
    if (remainingMs > 0) return;
    if (timerCompletionStartedForRef.current === timerState.endsAt) return;
    timerCompletionStartedForRef.current = timerState.endsAt;
    setTimerCompleteUntil(Date.now() + TIMER_COMPLETE_DISPLAY_MS);
    fetch('/api/timer-end-trigger', { cache: 'no-store' }).catch(() => {});
  }, [timerState, remainingMs]);

  const isTimerCompletePhase =
    !!timerState && remainingMs <= 0 && timerCompleteUntil != null && now < timerCompleteUntil;
  const hasTimer = !!timerState && (remainingMs > 0 || isTimerCompletePhase);

  const wallet = settings.walletState;
  const walletEnabled = settings.walletEnabled;
  const showWallet = walletEnabled && wallet != null;

  const challenges = settings.challengesState?.challenges ?? [];
  const activeChallenges = challenges.filter((c) => c.status === 'active');

  const hasContent = hasTimer || activeChallenges.length > 0 || showWallet;
  if (!hasContent) return null;

  const renderTimer = () => {
    const label = timerState?.title || 'TIMER';
    if (isTimerCompletePhase) {
      return (
        <div className="goal-progress-stack">
          <div className="goal-progress-bar">
            <div className="timer-countdown-bar" aria-label="Timer complete">
              <div className="timer-countdown-bar-fill" style={{ width: '0%' }} />
            </div>
            <div className="goal-progress-text">
              <div className="goal-progress-lines">
                <span className="goal-progress-value">Time&apos;s up!</span>
                <span className="goal-progress-subtext">{label}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (!timerState) return null;
    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = hours > 0 ? `${hours.toString().padStart(2, '0')}:` : '';
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    const timeStr = `${hh}${mm}:${ss}`;
    const totalMs = timerState.endsAt - timerState.createdAt;
    const fillPct = totalMs > 0 ? Math.min(100, Math.round((remainingMs / totalMs) * 100)) : 100;
    return (
      <div className="goal-progress-stack">
        <div className="goal-progress-bar">
          <div className="timer-countdown-bar" aria-label="Time remaining">
            <div className="timer-countdown-bar-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <div className="goal-progress-text">
            <div className="goal-progress-lines">
              <span className="goal-progress-value">{timeStr}</span>
              <span className="goal-progress-subtext">{label}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="challenges-box">
      {showWallet && (
        <div className="challenges-wallet">
          <span className="challenges-wallet-label">WALLET</span>
          <span className="challenges-wallet-balance">${wallet!.balance.toFixed(2)}</span>
        </div>
      )}
      {hasTimer && renderTimer()}
      {activeChallenges.length > 0 && (
        <div className="challenges-list">
          <div className="challenges-list-header">CHALLENGES</div>
          {activeChallenges.map((c, i) => (
            <div key={c.id} className="challenge-item">
              <span className="challenge-num">{i + 1}.</span>
              <span className="challenge-bounty">${c.bounty % 1 === 0 ? c.bounty.toFixed(0) : c.bounty.toFixed(2)}</span>
              <span className="challenge-desc">{c.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
