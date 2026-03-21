/**
 * Goal chat commands — mods and broadcaster only.
 *
 * !subsgoal <target>          — auto-iterating sub goal in multiples of <target>
 * !subsgoal <target> <label>  — fixed sub goal at <target> with label (holds at 100% until cleared)
 * !kicksgoal <target>          — auto-iterating kicks goal
 * !kicksgoal <target> <label>  — fixed kicks goal with label
 * !clearsubsgoal               — hide sub goal, reset to saved increment
 * !clearkicksgoal              — hide kicks goal, reset to saved increment
 * !cleargoals                  — hide both, reset both to saved increments
 * !subscount <count>           — manually override current subs count
 * !kickscount <count>          — manually override current kicks count
 * !timer <minutes> [label]     — start/restart a countdown timer on the overlay
 * !timers                      — list currently active timers (public)
 * !cleartimer                  — clear the current countdown timer
 * !resetstream                 — broadcaster only: resets all per-stream state (same as Danger Zone button)
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { setStreamGoals, getStreamGoals, STREAM_GOALS_MODIFIED_KEY, resetStreamGoalsOnStreamStart } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { bumpGoalTarget } from '@/utils/stream-goals-celebration';
import { setOverlayTimer, addTimer, removeTimerByCreatedAt, getOverlayTimers } from '@/utils/overlay-timer-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { onStreamStarted, setStreamLive } from '@/utils/stats-storage';
import { resetWallet, resetChallenges } from '@/utils/challenges-storage';
import { POLL_STATE_KEY, POLL_QUEUE_KEY, LAST_POLL_ENDED_AT_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY } from '@/types/trivia';

const OVERLAY_ALERTS_KEY = 'kick_overlay_alerts';
const OVERLAY_TIMER_ANNOUNCED_KEY = 'overlay_timer_announced_ends_at';

const OVERLAY_SETTINGS_KEY = 'overlay_settings';

export interface HandleGoalCommandResult {
  handled: boolean;
  reply?: string;
}

/** Parse "!subsgoal 20 Go to the zoo" → { target: 20, subtext: "Go to the zoo" | undefined } */
function parseGoalArgs(args: string): { target: number; subtext: string | undefined } | null {
  const parts = args.trim().split(/\s+/);
  const target = parseInt(parts[0], 10);
  if (!Number.isFinite(target) || target < 1) return null;
  const subtext = parts.slice(1).join(' ').trim() || undefined;
  return { target, subtext };
}

/**
 * If currentCount already meets or exceeds the requested target, bump up in
 * multiples of increment until strictly above count.
 * e.g. target=5, increment=5, count=12 → 15
 */
function effectiveTarget(target: number, increment: number, currentCount: number): number {
  if (currentCount < target) return target;
  const inc = Math.max(1, increment);
  return (Math.floor(currentCount / inc) + 1) * inc;
}

export async function handleGoalCommand(
  content: string,
  sender: string,
  senderPayload: unknown
): Promise<HandleGoalCommandResult> {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  const isGoalCmd =
    lower === '!cleargoals' ||
    lower === '!clearsubsgoal' ||
    lower === '!clearkicksgoal' ||
    lower.startsWith('!subsgoal') ||
    lower.startsWith('!kicksgoal') ||
    lower === '!subscount' || lower.startsWith('!subscount ') ||
    lower === '!kickscount' || lower.startsWith('!kickscount ') ||
    lower.startsWith('!timer') ||
    lower === '!cleartimer' || lower.startsWith('!cleartimer ') ||
    lower === '!resetstream' ||
    lower === '!timers';

  if (!isGoalCmd) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);

  // ── !resetstream — broadcaster only ─────────────────────────────────────────
  if (lower === '!resetstream') {
    const isBroadcaster = !!broadcasterSlug && sender.toLowerCase() === broadcasterSlug.toLowerCase();
    if (!isBroadcaster) return { handled: true }; // silently ignore non-broadcasters

    const storedSettings = await kv.get<Record<string, unknown>>('overlay_settings');
    const startingBalance = (storedSettings?.walletStartingBalance as number) ?? 15;
    const startShowWallet = (storedSettings?.startShowWallet as boolean) ?? false;
    const startShowSpent = (storedSettings?.startShowSpent as boolean) ?? true;

    await kv.set(OVERLAY_SETTINGS_KEY, { ...(storedSettings ?? {}), walletEnabled: startShowWallet, showSpentOverlay: startShowSpent });

    const [{ subTarget }] = await Promise.all([
      resetStreamGoalsOnStreamStart(),
      setStreamLive(true),
      onStreamStarted(),
      resetWallet(startingBalance),
      resetChallenges(),
      setOverlayTimer(null),
      kv.del(POLL_STATE_KEY),
      kv.del(POLL_QUEUE_KEY),
      kv.del(LAST_POLL_ENDED_AT_KEY),
      kv.del(TRIVIA_STATE_KEY),
      kv.del(OVERLAY_ALERTS_KEY),
      kv.del(OVERLAY_TIMER_ANNOUNCED_KEY),
    ]);

    void broadcastChallenges().catch(() => {});
    void updateKickTitleGoals(0, subTarget).catch(() => {});

    return { handled: true, reply: '✅ Stream session reset.' };
  }

  // ── !timers — public, list active timers ────────────────────────────────────
  if (lower === '!timers') {
    const timers = await getOverlayTimers();
    const active = timers.filter((t) => t.endsAt > Date.now());
    if (active.length === 0) return { handled: true, reply: '⏱️ No timers running.' };
    const now = Date.now();
    const parts = active.map((t) => {
      const secsLeft = Math.max(0, Math.round((t.endsAt - now) / 1000));
      const m = Math.floor(secsLeft / 60);
      const s = secsLeft % 60;
      const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
      return t.title ? `"${t.title}" (${timeStr})` : timeStr;
    });
    return { handled: true, reply: `⏱️ Active timers: ${parts.join(' | ')}` };
  }

  if (!isModOrBroadcaster(senderPayload, sender, broadcasterSlug)) {
    return { handled: true }; // silently ignore non-mods
  }

  const settings = (await kv.get<Record<string, unknown>>(OVERLAY_SETTINGS_KEY)) ?? {};
  const subIncrement   = Math.max(1, (settings.subGoalIncrement  as number) || 5);
  const kicksIncrement = Math.max(1, (settings.kicksGoalIncrement as number) || 5000);

  /** Push updated settings to all connected SSE clients immediately. */
  const notifyOverlay = () => {
    void kv.set('overlay_settings_modified', Date.now()).catch(() => {});
    void broadcastChallenges().catch(() => {});
  };

  /** Fire-and-forget title refresh. */
  const refreshTitle = (subTarget: number, kicksTarget: number) => {
    void (async () => {
      const goals = await getStreamGoals();
      void updateKickTitleGoals(goals.subs, subTarget, goals.kicks, kicksTarget).catch(() => {});
    })();
  };

  // ── !cleartimer [label] ───────────────────────────────────────────────────────
  if (lower === '!cleartimer' || lower.startsWith('!cleartimer ')) {
    const labelArg = trimmed.slice('!cleartimer'.length).trim();
    if (!labelArg) {
      await setOverlayTimer(null);
      notifyOverlay();
      return { handled: true, reply: '✅ All timers cleared' };
    }
    const timers = await getOverlayTimers();
    const target = timers.find((t) => t.title?.toLowerCase().includes(labelArg.toLowerCase()));
    if (!target) return { handled: true, reply: `No timer found matching "${labelArg}"` };
    await removeTimerByCreatedAt(target.createdAt);
    notifyOverlay();
    return { handled: true, reply: `✅ Timer "${target.title}" cleared` };
  }

  // ── !clearsubsgoal ──────────────────────────────────────────────────────────
  if (lower === '!clearsubsgoal') {
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showSubGoal: false,
      subGoalTarget: subIncrement,
      subGoalSubtext: null,
    });
    notifyOverlay();
    refreshTitle(subIncrement, kicksTarget);
    return { handled: true, reply: '✅ Sub goal cleared' };
  }

  // ── !clearkicksgoal ─────────────────────────────────────────────────────────
  if (lower === '!clearkicksgoal') {
    const subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showKicksGoal: false,
      kicksGoalTarget: kicksIncrement,
      kicksGoalSubtext: null,
    });
    notifyOverlay();
    refreshTitle(subTarget, kicksIncrement);
    return { handled: true, reply: '✅ Kicks goal cleared' };
  }

  // ── !cleargoals ─────────────────────────────────────────────────────────────
  if (lower === '!cleargoals') {
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showSubGoal: false,
      subGoalTarget: subIncrement,
      subGoalSubtext: null,
      showKicksGoal: false,
      kicksGoalTarget: kicksIncrement,
      kicksGoalSubtext: null,
    });
    notifyOverlay();
    refreshTitle(subIncrement, kicksIncrement);
    return { handled: true, reply: '✅ All goals cleared' };
  }

  // ── !timer <duration> [label] ───────────────────────────────────────────────
  // Bare number = minutes. Suffixes: s/sec = seconds, m/min = minutes, h/hr = hours.
  // e.g. !timer 5 Break | !timer 90s | !timer 1h Lunch | !timer 30sec
  if (lower.startsWith('!timer')) {
    const args = trimmed.slice('!timer'.length).trim();
    if (!args) {
      return { handled: true, reply: 'Usage: !timer <duration> [label]  e.g. !timer 5 Break  or  !timer 90s  or  !timer 1h Lunch' };
    }
    const parts = args.split(/\s+/);
    const first = String(parts[0])
      .replace(/[０-９]/g, (c) => String('０１２３４５６７８９'.indexOf(c)))
      .trim();
    const match = first.match(/^([\d.]+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i);
    if (!match) {
      return { handled: true, reply: 'Usage: !timer <duration> [label]  e.g. !timer 5  or  !timer 90s  or  !timer 1h Lunch' };
    }
    const num = parseFloat(match[1]);
    const unitRaw = (match[2] || 'm').toLowerCase();
    const unit = unitRaw.startsWith('h') ? 'h' : unitRaw.startsWith('s') ? 's' : 'm';
    if (!Number.isFinite(num) || num <= 0) {
      return { handled: true, reply: 'Usage: !timer <duration> [label]  e.g. !timer 5  or  !timer 90s  or  !timer 1h' };
    }
    let minutes: number;
    if (unit === 's') minutes = num / 60;
    else if (unit === 'h') minutes = num * 60;
    else minutes = num;
    const clampedMinutes = Math.min(Math.max(minutes, 1 / 60), 12 * 60); // min 1 sec, max 12 hours
    const label = parts.slice(1).join(' ').trim() || undefined;
    const now = Date.now();
    const endsAt = now + clampedMinutes * 60_000;
    const added = await addTimer({ createdAt: now, endsAt, title: label });
    if (!added) return { handled: true, reply: '⚠️ Max 3 timers already running. Use !cleartimer [label] to remove one.' };
    notifyOverlay();
    let durationStr: string;
    if (clampedMinutes >= 60) {
      const hrs = clampedMinutes / 60;
      durationStr = hrs % 1 === 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hours`;
    } else if (clampedMinutes < 1) {
      const secs = Math.round(clampedMinutes * 60);
      durationStr = `${secs} second${secs !== 1 ? 's' : ''}`;
    } else {
      durationStr = clampedMinutes % 1 === 0 ? `${clampedMinutes} minute${clampedMinutes !== 1 ? 's' : ''}` : `${clampedMinutes.toFixed(1)} minutes`;
    }
    const suffix = label ? ` — "${label}"` : '';
    return { handled: true, reply: `✅ Timer started: ${durationStr}${suffix}` };
  }

  // ── !subsgoal ───────────────────────────────────────────────────────────────
  if (lower.startsWith('!subsgoal')) {
    const args = trimmed.slice('!subsgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !subsgoal <number> [label]  e.g. !subsgoal 20  or  !subsgoal 20 Buy a drink' };
    }
    const goals = await getStreamGoals();
    // With label: goal is fixed at the given target (bar holds at 100% until cleared).
    // Without label: auto-iterate — bump past current count if already there.
    const activeTarget = parsed.subtext
      ? parsed.target
      : effectiveTarget(parsed.target, parsed.target, goals.subs);
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showSubGoal: true,
      subGoalTarget: activeTarget,
      subGoalIncrement: parsed.target,
      subGoalSubtext: parsed.subtext ?? null,
    });
    notifyOverlay();
    refreshTitle(activeTarget, kicksTarget);
    const bumped = activeTarget !== parsed.target ? ` (bumped to ${activeTarget} — already at ${goals.subs} subs)` : '';
    const reply = parsed.subtext
      ? `✅ Sub goal set: ${parsed.target} subs — "${parsed.subtext}"`
      : `✅ Sub goal set: ${activeTarget} subs${bumped}`;
    return { handled: true, reply };
  }

  // ── !kicksgoal ──────────────────────────────────────────────────────────────
  if (lower.startsWith('!kicksgoal')) {
    const args = trimmed.slice('!kicksgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !kicksgoal <number> [label]  e.g. !kicksgoal 5000  or  !kicksgoal 5000 Buy a drink' };
    }
    const goals = await getStreamGoals();
    const activeTarget = parsed.subtext
      ? parsed.target
      : effectiveTarget(parsed.target, parsed.target, goals.kicks);
    const subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showKicksGoal: true,
      kicksGoalTarget: activeTarget,
      kicksGoalIncrement: parsed.target,
      kicksGoalSubtext: parsed.subtext ?? null,
    });
    notifyOverlay();
    refreshTitle(subTarget, activeTarget);
    const bumped = activeTarget !== parsed.target ? ` (bumped to ${activeTarget} — already at ${goals.kicks} KICKs)` : '';
    const reply = parsed.subtext
      ? `✅ KICKs goal set: ${parsed.target} KICKs — "${parsed.subtext}"`
      : `✅ KICKs goal set: ${activeTarget} KICKs${bumped}`;
    return { handled: true, reply };
  }

  // ── !subscount <count> ──────────────────────────────────────────────────────
  if (lower === '!subscount' || lower.startsWith('!subscount ')) {
    const arg = trimmed.slice('!subscount'.length).trim();
    const count = parseInt(arg, 10);
    if (!Number.isFinite(count) || count < 0) {
      return { handled: true, reply: 'Usage: !subscount <number>  e.g. !subscount 15' };
    }
    await setStreamGoals({ subs: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});

    let subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    const hasSubtext = !!(settings.subGoalSubtext as string | null | undefined);
    // Recalculate target whenever count moves (up or down) and no fixed label is set
    if (subTarget > 0 && !hasSubtext) {
      const correctTarget = (Math.floor(count / subIncrement) + 1) * subIncrement;
      if (correctTarget !== subTarget) {
        subTarget = await bumpGoalTarget('subs', subTarget, subIncrement, count);
      }
    }
    notifyOverlay();
    refreshTitle(subTarget, kicksTarget);
    return { handled: true, reply: `✅ Sub count set to ${count}` };
  }

  // ── !kickscount <count> ─────────────────────────────────────────────────────
  if (lower === '!kickscount' || lower.startsWith('!kickscount ')) {
    const arg = trimmed.slice('!kickscount'.length).trim();
    const count = parseInt(arg, 10);
    if (!Number.isFinite(count) || count < 0) {
      return { handled: true, reply: 'Usage: !kickscount <number>  e.g. !kickscount 1500' };
    }
    await setStreamGoals({ kicks: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});

    const subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    let kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    const hasKicksSubtext = !!(settings.kicksGoalSubtext as string | null | undefined);
    // Recalculate target whenever count moves (up or down) and no fixed label is set
    if (kicksTarget > 0 && !hasKicksSubtext) {
      const correctTarget = (Math.floor(count / kicksIncrement) + 1) * kicksIncrement;
      if (correctTarget !== kicksTarget) {
        kicksTarget = await bumpGoalTarget('kicks', kicksTarget, kicksIncrement, count);
      }
    }
    notifyOverlay();
    refreshTitle(subTarget, kicksTarget);
    return { handled: true, reply: `✅ KICKs count set to ${count}` };
  }

  return { handled: false };
}
