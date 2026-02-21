'use client';

import { useState, useEffect, useRef } from 'react';
import type { OverlaySettings } from '@/types/settings';
import { getLeaderboardDisplayMode } from '@/utils/overlay-utils';

const ALERT_DISPLAY_MS = 8000;

export default function BottomRightPanel({
  settings,
  visibleTodos,
  children,
}: {
  settings: OverlaySettings;
  visibleTodos: { id: string; text: string; completed: boolean }[];
  children: React.ReactNode;
}) {
  const poll = settings.pollState;
  const isPollActive = poll && (poll.status === 'active' || (poll.status === 'winner' && poll.winnerDisplayUntil != null && Date.now() < poll.winnerDisplayUntil));
  const totalVotes = poll?.options?.reduce((s, o) => s + o.votes, 0) ?? 0;
  const showPoll = isPollActive && totalVotes >= 0;

  const leaderboardDisplay = getLeaderboardDisplayMode(settings);
  const showLeaderboard = leaderboardDisplay !== 'hidden';
  const leaderboardAlways = leaderboardDisplay === 'always';
  const leaderboardTopN = settings.leaderboardTopN ?? 5;
  const intervalMin = (settings.leaderboardIntervalMin ?? 10) * 60 * 1000;
  const durationSec = (settings.leaderboardDurationSec ?? 30) * 1000;

  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const lastHideAtRef = useRef<number>(0);
  const showStartedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!showLeaderboard || showPoll) {
      setLeaderboardVisible(false);
      return;
    }
    if (leaderboardAlways) {
      setLeaderboardVisible(true);
      return;
    }
    const check = () => {
      const now = Date.now();
      if (leaderboardVisible) {
        if (now - showStartedAtRef.current >= durationSec) {
          setLeaderboardVisible(false);
          lastHideAtRef.current = now;
        }
      } else {
        const sinceHide = now - lastHideAtRef.current;
        if (lastHideAtRef.current === 0 || sinceHide >= intervalMin) {
          showStartedAtRef.current = now;
          setLeaderboardVisible(true);
        }
      }
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [showLeaderboard, showPoll, leaderboardAlways, leaderboardVisible, intervalMin, durationSec]);

  const leaderboardTop = settings.leaderboardTop ?? [];
  const leaderboardDataLoaded = Array.isArray(settings.leaderboardTop);
  const overlayAlerts = settings.overlayAlerts ?? [];
  const showOverlayAlerts = settings.showOverlayAlerts !== false;

  // Track which alerts we've shown to auto-dismiss after ALERT_DISPLAY_MS
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const shownRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!showOverlayAlerts || overlayAlerts.length === 0) return;
    overlayAlerts.forEach((a) => {
      if (!a?.id) return;
      const at = shownRef.current.get(a.id) ?? a.at;
      shownRef.current.set(a.id, at);
      const age = Date.now() - at;
      if (age >= ALERT_DISPLAY_MS) {
        setDismissedAlertIds((prev) => new Set(prev).add(a.id));
      }
    });
  }, [overlayAlerts, showOverlayAlerts]);

  const visibleAlerts = showOverlayAlerts
    ? overlayAlerts.filter((a) => a?.id && !dismissedAlertIds.has(a.id))
    : [];

  const hasContent =
    (settings.showTodoList && visibleTodos.length > 0) ||
    showPoll ||
    (showLeaderboard && (leaderboardAlways || leaderboardVisible)) ||
    visibleAlerts.length > 0;

  if (!hasContent) return null;

  const alertLabels: Record<string, string> = {
    sub: '🎉 New sub',
    resub: '💪 Resub',
    giftSub: '🎁 Gift sub',
    kicks: '💰 Kicks',
  };

  return (
    <div className="bottom-right">
      {children}

      {!showPoll && showLeaderboard && leaderboardDataLoaded && (leaderboardAlways || leaderboardVisible) && (
        <div className="overlay-box leaderboard-box">
          <div className="leaderboard-title">🏆 Leaderboard</div>
          <div className="leaderboard-entries">
            {leaderboardTop.length > 0 ? (
              leaderboardTop.slice(0, leaderboardTopN).map((u, i) => (
                <div key={u.username} className="leaderboard-entry">
                  <span className="leaderboard-rank">#{i + 1}</span>
                  <span className="leaderboard-username">{u.username.replace(/^@+/, '')}</span>
                  <span className="leaderboard-points">{u.points} pts</span>
                </div>
              ))
            ) : (
              <div className="leaderboard-entry leaderboard-empty">No points yet — chat to earn!</div>
            )}
          </div>
        </div>
      )}

      {!showPoll && visibleAlerts.length > 0 && (
        <div className="overlay-alerts-stack">
          {visibleAlerts.slice(0, 3).map((a) => (
            <div key={a.id} className="overlay-box overlay-alert-box" data-type={a.type}>
              <span className="overlay-alert-label">{alertLabels[a.type] ?? a.type}</span>
              <span className="overlay-alert-username">{a.username}</span>
              {a.extra && <span className="overlay-alert-extra">{a.extra}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
