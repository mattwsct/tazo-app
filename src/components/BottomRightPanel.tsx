'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import GoalProgressBar from './GoalProgressBar';

const ALERT_DISPLAY_MS = 8000;
const GOALS_CYCLE_DURATION_MS = 32000; // 4x base rotation (8s)
const CROSSFADE_DURATION_MS = 500;

type GoalSlide = 'subs' | 'kicks';
type LbPollSlide = 'leaderboard' | 'poll';

type OverlayAlert = { id: string; type: string; username: string; extra?: string; at: number };

const ALERT_LABELS: Record<string, string> = {
  sub: '🎉 New sub',
  resub: '💪 Resub',
  giftSub: '🎁 Gift sub',
  kicks: '💰 Kicks',
};

export default function BottomRightPanel({
  settings,
  refreshSettings,
  children,
}: {
  settings: OverlaySettings;
  refreshSettings?: () => Promise<void>;
  children: React.ReactNode;
}) {
  const poll = settings.pollState;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const isPollActive =
    poll &&
    (poll.status === 'active' ||
      (poll.status === 'winner' && poll.winnerDisplayUntil != null && now < poll.winnerDisplayUntil));
  const totalVotes = poll?.options?.reduce((s, o) => s + o.votes, 0) ?? 0;
  const showPoll = !!(isPollActive && totalVotes >= 0);

  const gamblingEnabled = settings.gamblingEnabled !== false;
  const showLeaderboard = settings.showLeaderboard !== false && gamblingEnabled;
  const showGoalsRotation = settings.showGoalsRotation !== false;
  const leaderboardTopN = settings.gamblingLeaderboardTopN ?? settings.leaderboardTopN ?? 5;
  const gamblingLeaderboardTop = settings.gamblingLeaderboardTop ?? [];
  const overlayAlerts = useMemo(() => settings.overlayAlerts ?? [], [settings.overlayAlerts]);
  const showOverlayAlerts = settings.showOverlayAlerts !== false;

  const showSubGoal = settings.showSubGoal && (settings.subGoalTarget ?? 0) > 0;
  const showKicksGoal = settings.showKicksGoal && (settings.kicksGoalTarget ?? 0) > 0;
  const hasSubTarget = (settings.subGoalTarget ?? 0) > 0;
  const hasKicksTarget = (settings.kicksGoalTarget ?? 0) > 0;
  const streamGoals = settings.streamGoals ?? { subs: 0, kicks: 0 };

  // Cache poll children for outgoing crossfade (children may be null when poll ends)
  const pollChildrenCacheRef = useRef<React.ReactNode>(null);
  if (children) pollChildrenCacheRef.current = children;

  // =============================================
  // SECTION 1: Goals rotation (subs / kicks)
  // =============================================

  const goalSlides = (['subs', 'kicks'] as GoalSlide[]).filter((s) => {
    if (s === 'subs') return showSubGoal;
    if (s === 'kicks') return showKicksGoal;
    return false;
  });
  const goalSlidesRef = useRef<GoalSlide[]>(goalSlides);
  const goalSlidesKey = goalSlides.join(',');
  useEffect(() => { goalSlidesRef.current = goalSlides; }, [goalSlides, goalSlidesKey]);

  const [activeGoal, setActiveGoal] = useState<GoalSlide | null>(goalSlides[0] ?? null);
  const [displayedGoal, setDisplayedGoal] = useState<GoalSlide | null>(goalSlides[0] ?? null);
  const [outgoingGoal, setOutgoingGoal] = useState<GoalSlide | null>(null);
  const goalHoldUntilRef = useRef<number>(0);
  const goalTransitionRef = useRef<NodeJS.Timeout | null>(null);

  const lastSeenAlertIdsRef = useRef<Set<string>>(new Set());
  const subsAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kicksAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpedSubsUntilRef = useRef<number | null>(null);
  const bumpedKicksUntilRef = useRef<number | null>(null);

  const [subsAlert, setSubsAlert] = useState<OverlayAlert | null>(null);
  const [kicksAlert, setKicksAlert] = useState<OverlayAlert | null>(null);

  useEffect(() => {
    if (goalSlides.length === 0) {
      setActiveGoal(null);
      setDisplayedGoal(null);
      setOutgoingGoal(null);
      return;
    }
    if (activeGoal && goalSlides.includes(activeGoal)) return;
    setActiveGoal(goalSlides[0]);
    setDisplayedGoal(goalSlides[0]);
    setOutgoingGoal(null);
  }, [goalSlides, activeGoal]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- displayedGoal, outgoingGoal are outputs
  useEffect(() => {
    if (activeGoal == null || goalSlides.length === 0) return;
    if (activeGoal === displayedGoal && !outgoingGoal) return;

    setOutgoingGoal(displayedGoal ?? activeGoal);
    if (goalTransitionRef.current) clearTimeout(goalTransitionRef.current);
    goalTransitionRef.current = setTimeout(() => {
      goalTransitionRef.current = null;
      setDisplayedGoal(activeGoal);
      setOutgoingGoal(null);
    }, CROSSFADE_DURATION_MS);
    return () => { if (goalTransitionRef.current) clearTimeout(goalTransitionRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoal]);

  // Alert bumping — switch to relevant goal on sub/kicks alerts
  useEffect(() => {
    if (!showOverlayAlerts || overlayAlerts.length === 0 || (!hasSubTarget && !hasKicksTarget)) return;
    const seen = lastSeenAlertIdsRef.current;
    for (const a of overlayAlerts) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);

      const isSubType = a.type === 'sub' || a.type === 'resub' || a.type === 'giftSub';
      const isKicksType = a.type === 'kicks';

      if (isSubType && hasSubTarget) {
        goalHoldUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveGoal('subs');
          setSubsAlert(a);
        });
        if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
        subsAlertClearRef.current = setTimeout(() => {
          subsAlertClearRef.current = null;
          setSubsAlert(null);
        }, ALERT_DISPLAY_MS);
        break;
      }
      if (isKicksType && hasKicksTarget) {
        goalHoldUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveGoal('kicks');
          setKicksAlert(a);
        });
        if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
        kicksAlertClearRef.current = setTimeout(() => {
          kicksAlertClearRef.current = null;
          setKicksAlert(null);
        }, ALERT_DISPLAY_MS);
        break;
      }
    }
  }, [overlayAlerts, showOverlayAlerts, hasSubTarget, hasKicksTarget, showGoalsRotation]);

  // Goals cycling (wall clock aligned)
  useEffect(() => {
    if (!showGoalsRotation || goalSlides.length <= 1) return;
    const tick = () => {
      if (Date.now() < goalHoldUntilRef.current) return;
      const current = goalSlidesRef.current;
      if (current.length <= 1) return;
      setActiveGoal((prev) => {
        const idx = prev && current.includes(prev) ? current.indexOf(prev) : 0;
        return current[(idx + 1) % current.length];
      });
    };
    const msUntilNext = GOALS_CYCLE_DURATION_MS - (Date.now() % GOALS_CYCLE_DURATION_MS);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const initialTimeout = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, GOALS_CYCLE_DURATION_MS);
    }, msUntilNext);
    return () => { clearTimeout(initialTimeout); if (intervalId) clearInterval(intervalId); };
  }, [showGoalsRotation, goalSlides.length, goalSlidesKey]);

  // =============================================
  // SECTION 2: Leaderboard / Poll crossfade
  // =============================================

  const lbTarget: LbPollSlide = showPoll ? 'poll' : 'leaderboard';
  const [lbDisplayed, setLbDisplayed] = useState<LbPollSlide>(lbTarget);
  const [lbOutgoing, setLbOutgoing] = useState<LbPollSlide | null>(null);
  const lbTransRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (lbTransRef.current) { clearTimeout(lbTransRef.current); lbTransRef.current = null; }
    if (lbTarget === lbDisplayed) {
      setLbOutgoing(null);
      return;
    }
    setLbOutgoing(lbDisplayed);
    lbTransRef.current = setTimeout(() => {
      lbTransRef.current = null;
      setLbDisplayed(lbTarget);
      setLbOutgoing(null);
    }, CROSSFADE_DURATION_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbTarget]);

  // =============================================
  // Celebration bumping (goal reached → bump target)
  // =============================================

  useEffect(() => {
    if (!showSubGoal && !showKicksGoal) return;

    const subsUntil = settings.subGoalCelebrationUntil;
    const kicksUntil = settings.kicksGoalCelebrationUntil;
    const subTarget = settings.subGoalTarget ?? 10;
    const kicksTarget = settings.kicksGoalTarget ?? 1000;

    const maybeBump = async (type: 'subs' | 'kicks', until: number | undefined, count: number, target: number, bumpedRef: React.MutableRefObject<number | null>) => {
      if (until == null || Date.now() < until || count < target || bumpedRef.current === until) return;
      bumpedRef.current = until;
      try {
        const res = await fetch('/api/bump-goal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.bumped && refreshSettings) await refreshSettings();
      } catch { /* ignore */ }
    };

    maybeBump('subs', subsUntil, streamGoals.subs, subTarget, bumpedSubsUntilRef);
    maybeBump('kicks', kicksUntil, streamGoals.kicks, kicksTarget, bumpedKicksUntilRef);
  }, [
    showSubGoal,
    showKicksGoal,
    settings.subGoalCelebrationUntil,
    settings.kicksGoalCelebrationUntil,
    settings.subGoalTarget,
    settings.kicksGoalTarget,
    streamGoals.subs,
    streamGoals.kicks,
    now,
    refreshSettings,
  ]);

  useEffect(() => {
    return () => {
      if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
      if (kicksAlertClearRef.current) clearTimeout(kicksAlertClearRef.current);
    };
  }, []);

  // =============================================
  // Visibility
  // =============================================

  const hasGoalsContent = showGoalsRotation && goalSlides.length > 0;
  const hasGoalAlertContent = !hasGoalsContent && (hasSubTarget || hasKicksTarget) && (subsAlert != null || kicksAlert != null);
  const hasLbPollContent = showLeaderboard || showPoll;
  const hasContent = hasGoalsContent || hasGoalAlertContent || hasLbPollContent;

  if (!hasContent) return null;

  // =============================================
  // Render helpers
  // =============================================

  const renderLeaderboard = () => (
    <div className="overlay-box leaderboard-box">
      <div className="leaderboard-title">🃏 Top Chips</div>
      <div className="leaderboard-subtitle">Resets each stream</div>
      <div className="leaderboard-entries">
        {gamblingLeaderboardTop.length > 0 ? (
          gamblingLeaderboardTop.slice(0, leaderboardTopN).map((u, i) => (
            <div key={u.username} className="leaderboard-entry">
              <span className="leaderboard-rank">#{i + 1}</span>
              <span className="leaderboard-username">{u.username.replace(/^@+/, '')}</span>
              <span className="leaderboard-chips">{u.chips} chips</span>
            </div>
          ))
        ) : (
          <div className="leaderboard-entry leaderboard-empty">No chips yet — !deal to play blackjack!</div>
        )}
      </div>
    </div>
  );

  const renderSubsGoal = () => (
    <div className="goal-progress-stack">
      <GoalProgressBar
        label="SUBS"
        current={streamGoals.subs}
        target={settings.subGoalTarget ?? 10}
        formatValue={(n) => String(Math.round(n))}
        fillStyle="linear-gradient(90deg, rgba(139, 92, 246, 0.75) 0%, rgba(168, 85, 247, 0.9) 100%)"
        subtext={settings.subGoalSubtext}
        activeAlert={subsAlert}
        alertLabel={subsAlert ? ALERT_LABELS[subsAlert.type] ?? subsAlert.type : undefined}
        celebrationUntil={settings.subGoalCelebrationUntil}
        now={now}
      />
    </div>
  );

  const renderKicksGoal = () => (
    <div className="goal-progress-stack">
      <GoalProgressBar
        label="KICKS"
        current={streamGoals.kicks}
        target={settings.kicksGoalTarget ?? 1000}
        formatValue={(n) => String(Math.round(n))}
        fillStyle="linear-gradient(90deg, rgba(16, 185, 129, 0.75) 0%, rgba(52, 211, 153, 0.95) 100%)"
        subtext={settings.kicksGoalSubtext}
        activeAlert={kicksAlert}
        alertLabel={kicksAlert ? ALERT_LABELS[kicksAlert.type] ?? kicksAlert.type : undefined}
        celebrationUntil={settings.kicksGoalCelebrationUntil}
        now={now}
      />
    </div>
  );

  const renderGoalSlide = (type: GoalSlide) => {
    if (type === 'subs') return renderSubsGoal();
    if (type === 'kicks') return renderKicksGoal();
    return null;
  };

  const renderLbPollSlide = (type: LbPollSlide, isOutgoing = false) => {
    if (type === 'leaderboard') return showLeaderboard ? renderLeaderboard() : null;
    return isOutgoing ? pollChildrenCacheRef.current : (children || pollChildrenCacheRef.current);
  };

  return (
    <div className="bottom-right">
      {/* Top: Goals rotation (subs/kicks) */}
      {hasGoalsContent && (
        <div className="bottom-right-cycling-wrapper">
          <div className="bottom-right-cycling-slots">
            {outgoingGoal && (
              <div className="bottom-right-cycling-slide cycling-slide-out" key={`goal-out-${outgoingGoal}`}>
                {renderGoalSlide(outgoingGoal)}
              </div>
            )}
            {(activeGoal || displayedGoal) && (
              <div className="bottom-right-cycling-slide cycling-slide-in" key={`goal-in-${activeGoal ?? displayedGoal}`}>
                {renderGoalSlide((activeGoal ?? displayedGoal)!)}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Alert-only goals when rotation hidden */}
      {hasGoalAlertContent && (
        <div className="bottom-right-alert-only">
          {subsAlert && hasSubTarget && renderSubsGoal()}
          {kicksAlert && hasKicksTarget && renderKicksGoal()}
        </div>
      )}
      {/* Bottom: Leaderboard / Poll crossfade */}
      {hasLbPollContent && (
        <div className="bottom-right-cycling-wrapper">
          <div className="bottom-right-cycling-slots">
            {lbOutgoing && (
              <div className="bottom-right-cycling-slide cycling-slide-out" key={`lb-out-${lbOutgoing}`}>
                {renderLbPollSlide(lbOutgoing, true)}
              </div>
            )}
            <div className="bottom-right-cycling-slide cycling-slide-in" key={`lb-in-${lbTarget}`}>
              {renderLbPollSlide(lbTarget)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
