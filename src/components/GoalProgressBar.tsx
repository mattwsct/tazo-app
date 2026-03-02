'use client';

export interface GoalAlert {
  type: string;
  username: string;
  extra?: string;
}

interface GoalProgressBarProps {
  label: string;
  current: number;
  target: number;
  formatValue: (n: number) => string;
  /** CSS gradient or solid color for the fill */
  fillStyle?: string;
  /** Optional second line (e.g. "10 subs = 10 min extra!") */
  subtext?: string;
  /** When set, show this alert instead of progress (e.g. "🎉 New sub from @user") */
  activeAlert?: GoalAlert | null;
  /** Label for the alert (e.g. "🎉 New sub") */
  alertLabel?: string;
  /** Current time (ms) — passed from parent to avoid Date.now() in render. */
  now?: number;
}

export default function GoalProgressBar({
  label,
  current,
  target,
  formatValue,
  fillStyle = 'linear-gradient(90deg, rgba(34, 197, 94, 0.8) 0%, rgba(16, 185, 129, 0.9) 100%)',
  subtext,
  activeAlert,
  alertLabel,
  now,
}: GoalProgressBarProps) {
  const targetSafe = Math.max(1, target);
  const pct = Math.min(100, Math.round((current / targetSafe) * 100));
  const isFull = current >= targetSafe;
  const mainText = `${label}: ${formatValue(current)} / ${formatValue(target)}`;
  const showAlert = activeAlert && alertLabel;

  return (
    <div className={`goal-progress-bar${showAlert ? ' goal-progress-bar-alert' : ''}${isFull && !showAlert ? ' goal-progress-bar--full' : ''}`}>
      <div
        className="goal-progress-fill"
        style={{
          width: showAlert ? '100%' : `${pct}%`,
          background: fillStyle,
        }}
      />
      <div className="goal-progress-text">
        <div className="goal-progress-lines">
          {showAlert ? (
            <>
              <span className="goal-progress-value goal-progress-alert-label">{alertLabel}</span>
              <span className="goal-progress-subtext goal-progress-alert-username">
                {activeAlert.username.replace(/^@+/, '')}
                {activeAlert.extra ? ` — ${activeAlert.extra}` : ''}
              </span>
            </>
          ) : (
            <>
              <span className="goal-progress-value">{mainText}</span>
              {subtext && subtext.trim() && (
                <span className="goal-progress-subtext">{subtext.trim()}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
