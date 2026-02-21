'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OverlaySettings } from '@/types/settings';
import GoalProgressBar from './GoalProgressBar';

const ALERT_DISPLAY_MS = 8000;
const CYCLE_DURATION_MS = 7000; // Time each slide is shown before fading to next
const CROSSFADE_DURATION_MS = 500; // Fade out + fade in overlap

type SlideType = 'leaderboard' | 'subs' | 'kicks';

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
  const showPoll = isPollActive && totalVotes >= 0;

  const showLeaderboard = settings.showLeaderboard !== false;
  const showGoalsRotation = settings.showGoalsRotation !== false;
  const leaderboardTopN = settings.leaderboardTopN ?? 5;
  const leaderboardTop = settings.leaderboardTop ?? [];
  const overlayAlerts = useMemo(() => settings.overlayAlerts ?? [], [settings.overlayAlerts]);
  const showOverlayAlerts = settings.showOverlayAlerts !== false;

  const showSubGoal = settings.showSubGoal && (settings.subGoalTarget ?? 0) > 0;
  const showKicksGoal = settings.showKicksGoal && (settings.kicksGoalTarget ?? 0) > 0;
  const streamGoals = settings.streamGoals ?? { subs: 0, kicks: 0 };

  // Build ordered slides (leaderboard, subs, kicks) - only include enabled ones
  const slides = (['leaderboard', 'subs', 'kicks'] as SlideType[]).filter((s) => {
    if (s === 'leaderboard') return showLeaderboard;
    if (s === 'subs') return showSubGoal;
    if (s === 'kicks') return showKicksGoal;
    return false;
  });
  const slidesRef = useRef<SlideType[]>(slides);
  const slidesKey = slides.join(',');
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides, slidesKey]);

  const [activeSlide, setActiveSlide] = useState<SlideType | null>(slides[0] ?? null);
  const [displayedSlide, setDisplayedSlide] = useState<SlideType | null>(slides[0] ?? null);
  const [outgoingSlide, setOutgoingSlide] = useState<SlideType | null>(null);
  const holdUntilRef = useRef<number>(0);
  const lastSeenAlertIdsRef = useRef<Set<string>>(new Set());
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subsAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kicksAlertClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpedSubsUntilRef = useRef<number | null>(null);
  const bumpedKicksUntilRef = useRef<number | null>(null);

  const [subsAlert, setSubsAlert] = useState<OverlayAlert | null>(null);
  const [kicksAlert, setKicksAlert] = useState<OverlayAlert | null>(null);

  // Update activeSlide when slides change (e.g. enable/disable goals)
  useEffect(() => {
    if (slides.length === 0) {
      setActiveSlide(null);
      setDisplayedSlide(null);
      setOutgoingSlide(null);
      return;
    }
    const current = activeSlide ? slides.indexOf(activeSlide) : -1;
    if (current >= 0 && slides.includes(activeSlide!)) return; // keep current if still valid
    setActiveSlide(slides[0]);
    setDisplayedSlide(slides[0]);
    setOutgoingSlide(null);
  }, [slides, activeSlide]);

  // Crossfade when activeSlide changes: fade out current, fade in next
  // displayedSlide/outgoingSlide intentionally omitted — they are effect outputs, not inputs
  useEffect(() => {
    if (activeSlide == null || slides.length === 0) return;
    if (activeSlide === displayedSlide && !outgoingSlide) return;

    // Start transition — sync setState for crossfade; timeout handles async completion
    setOutgoingSlide(displayedSlide ?? activeSlide);

    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      setDisplayedSlide(activeSlide);
      setOutgoingSlide(null);
    }, CROSSFADE_DURATION_MS);

    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayedSlide, outgoingSlide are outputs
  }, [activeSlide]);

  // When new sub/resub/giftSub alert arrives → switch to subs and hold (or show alert-only bar when rotation hidden)
  // When new kicks alert arrives → switch to kicks and hold
  useEffect(() => {
    if (!showOverlayAlerts || overlayAlerts.length === 0 || (!showSubGoal && !showKicksGoal)) return;

    const seen = lastSeenAlertIdsRef.current;
    for (const a of overlayAlerts) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);

      const isSubType = a.type === 'sub' || a.type === 'resub' || a.type === 'giftSub';
      const isKicksType = a.type === 'kicks';

      if (isSubType && showSubGoal) {
        holdUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveSlide('subs');
          setSubsAlert(a);
        });
        if (subsAlertClearRef.current) clearTimeout(subsAlertClearRef.current);
        subsAlertClearRef.current = setTimeout(() => {
          subsAlertClearRef.current = null;
          setSubsAlert(null);
        }, ALERT_DISPLAY_MS);
        break;
      }
      if (isKicksType && showKicksGoal) {
        holdUntilRef.current = Date.now() + ALERT_DISPLAY_MS;
        queueMicrotask(() => {
          if (showGoalsRotation) setActiveSlide('kicks');
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
  }, [overlayAlerts, showOverlayAlerts, showSubGoal, showKicksGoal, showGoalsRotation]);

  // Cycle through slides (when not on hold) — runs even during poll so both show; skip when rotation hidden
  useEffect(() => {
    if (!showGoalsRotation || slides.length <= 1) return;

    const tick = () => {
      const now = Date.now();
      if (now < holdUntilRef.current) return; // still holding for alert

      const currentSlides = slidesRef.current;
      if (currentSlides.length <= 1) return;

      setActiveSlide((prev) => {
        const idx = prev && currentSlides.includes(prev) ? currentSlides.indexOf(prev) : 0;
        const next = (idx + 1) % currentSlides.length;
        return currentSlides[next];
      });
    };

    const id = setInterval(tick, CYCLE_DURATION_MS);
    return () => clearInterval(id);
  }, [showGoalsRotation, slides.length, slidesKey]);

  // When celebration window ends, bump goal via API (once per celebration)
  useEffect(() => {
    if (!showSubGoal && !showKicksGoal) return;

    const subsUntil = settings.subGoalCelebrationUntil;
    const kicksUntil = settings.kicksGoalCelebrationUntil;
    const subTarget = settings.subGoalTarget ?? 10;
    const kicksTarget = settings.kicksGoalTarget ?? 5000;

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

  const hasRotationContent = showGoalsRotation && slides.length > 0;
  const hasAlertOnlyContent = !showGoalsRotation && (showSubGoal || showKicksGoal) && (subsAlert != null || kicksAlert != null);
  const hasContent = showPoll || hasRotationContent || hasAlertOnlyContent;

  if (!hasContent) return null;

  const renderLeaderboard = () => (
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
        target={settings.kicksGoalTarget ?? 5000}
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

  return (
    <div className="bottom-right">
      {/* Top: rotating leaderboard/subs/kicks — or alert-only bars when rotation hidden */}
      {hasRotationContent && (
        <div className="bottom-right-cycling-wrapper">
          <div className="bottom-right-cycling-slots">
            {outgoingSlide && (
              <div className="bottom-right-cycling-slide cycling-slide-out" key={`out-${outgoingSlide}`}>
                {outgoingSlide === 'leaderboard' && renderLeaderboard()}
                {outgoingSlide === 'subs' && renderSubsGoal()}
                {outgoingSlide === 'kicks' && renderKicksGoal()}
              </div>
            )}
            {(activeSlide || displayedSlide) && (
              <div className="bottom-right-cycling-slide cycling-slide-in" key={`in-${activeSlide ?? displayedSlide}`}>
                {(activeSlide ?? displayedSlide) === 'leaderboard' && renderLeaderboard()}
                {(activeSlide ?? displayedSlide) === 'subs' && renderSubsGoal()}
                {(activeSlide ?? displayedSlide) === 'kicks' && renderKicksGoal()}
              </div>
            )}
          </div>
        </div>
      )}
      {/* When rotation hidden: show goal bars only when alert is active */}
      {hasAlertOnlyContent && (
        <div className="bottom-right-alert-only">
          {subsAlert && showSubGoal && renderSubsGoal()}
          {kicksAlert && showKicksGoal && renderKicksGoal()}
        </div>
      )}
      {/* Bottom: poll (when active) — stacks under rotation */}
      {children}
    </div>
  );
}
