'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import GoalProgressBar from './GoalProgressBar';

const ALERT_DISPLAY_MS = 10000;
// All rotations snap to multiples of this tick so transitions are wall-clock aligned
const ROTATION_TICK_MS = 10000;
const GOALS_CYCLE_DURATION_MS = ROTATION_TICK_MS;
const CROSSFADE_DURATION_MS = 500;

type GoalSlide = 'subs' | 'kicks';

type OverlayAlert = { id: string; type: string; username: string; extra?: string; at: number };

const ALERT_LABELS: Record<string, string> = {
  sub: '🎉 New sub',
  resub: '💪 Resub',
  giftSub: '🎁 Gift sub',
  kicks: '💚 Kicks',
};

export default function BottomRightPanel({
  settings,
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
  const trivia = settings.triviaState;
  const showTrivia =
    !showPoll &&
    !!trivia &&
    (!trivia.winnerDisplayUntil || now < trivia.winnerDisplayUntil);

  const showGoalsRotation = settings.showGoalsRotation !== false;
  const overlayAlerts = useMemo(() => settings.overlayAlerts ?? [], [settings.overlayAlerts]);
  const showOverlayAlerts = settings.showOverlayAlerts !== false;

  const subTarget = Math.max(1, settings.subGoalTarget ?? 10);
  const kicksTarget = Math.max(1, settings.kicksGoalTarget ?? 100);
  const showSubGoal = settings.showSubGoal && subTarget > 0;
  const showKicksGoal = settings.showKicksGoal && kicksTarget > 0;
  const streamGoals = settings.streamGoals ?? { subs: 0, kicks: 0 };

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
        subsAlertClearRef.current = setTimeout(() => {
          subsAlertClearRef.current = null;
          setSubsAlert(null);
        }, ALERT_DISPLAY_MS);
        break;
      }
      if (isKicksType) {
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
  }, [overlayAlerts, showOverlayAlerts, showGoalsRotation]);

  // Goals cycling (wall clock aligned, re-aligned on every tick to prevent drift)
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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const msUntilNext = GOALS_CYCLE_DURATION_MS - (Date.now() % GOALS_CYCLE_DURATION_MS);
      timeoutId = setTimeout(() => {
        tick();
        schedule();
      }, msUntilNext);
    };
    schedule();
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [showGoalsRotation, goalSlides.length, goalSlidesKey]);

  // =============================================
  // SECTION 2: Poll (when active)
  // =============================================

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
  const hasGoalAlertContent = !hasGoalsContent && (subsAlert != null || kicksAlert != null);
  const hasPollContent = showPoll;
  const hasTriviaContent = showTrivia;
  const hasPollOrTriviaContent = hasPollContent || hasTriviaContent;
  const hasContent = hasGoalsContent || hasGoalAlertContent || hasPollOrTriviaContent;

  if (!hasContent) return null;

  // =============================================
  // Render helpers
  // =============================================

  const renderSubsGoal = () => (
    <div className="goal-progress-stack">
      <GoalProgressBar
        label="SUBS"
        current={streamGoals.subs}
        target={subTarget}
        formatValue={(n) => String(Math.round(n))}
        fillStyle="linear-gradient(90deg, rgba(139, 92, 246, 0.75) 0%, rgba(168, 85, 247, 0.9) 100%)"
        subtext={settings.subGoalSubtext}
        activeAlert={subsAlert}
        alertLabel={subsAlert ? ALERT_LABELS[subsAlert.type] ?? subsAlert.type : undefined}
      />
    </div>
  );

  const renderKicksGoal = () => (
    <div className="goal-progress-stack">
      <GoalProgressBar
        label="KICKS"
        current={streamGoals.kicks}
        target={kicksTarget}
        formatValue={(n) => String(Math.round(n))}
        fillStyle="linear-gradient(90deg, rgba(16, 185, 129, 0.75) 0%, rgba(52, 211, 153, 0.95) 100%)"
        subtext={settings.kicksGoalSubtext}
        activeAlert={kicksAlert}
        alertLabel={kicksAlert ? ALERT_LABELS[kicksAlert.type] ?? kicksAlert.type : undefined}
      />
    </div>
  );

  const renderGoalSlide = (type: GoalSlide) => {
    if (type === 'subs') return renderSubsGoal();
    if (type === 'kicks') return renderKicksGoal();
    return null;
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
          {subsAlert && renderSubsGoal()}
          {kicksAlert && renderKicksGoal()}
        </div>
      )}
      {/* Bottom: Poll or Trivia when active */}
      {hasPollOrTriviaContent && (
        <div className="bottom-right-cycling-wrapper">
          <div className="bottom-right-cycling-slots">
            <div className="bottom-right-cycling-slide cycling-slide-in">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
