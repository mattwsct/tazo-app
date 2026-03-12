/**
 * Goal chat commands — mods and broadcaster only.
 *
 * !subsgoal <target>          — auto-iterating sub goal in multiples of <target>
 * !subsgoal <target> <label>  — fixed sub goal at <target> with label (holds at 100% until cleared)
 * !kicksgoal <target>          — auto-iterating kicks goal
 * !kicksgoal <target> <label>  — fixed kicks goal with label
 * !clearsubsgoal               — hide sub goal, reset to saved increment
 * !clearkicksgoal              — hide kicks goal, reset to saved increment
 * !cleartipsgoal               — hide tips goal, clear target/subtext
 * !cleargoals                  — hide both, reset both to saved increments
 * !subscount <count>           — manually override current subs count
 * !kickscount <count>          — manually override current kicks count
 * !tipscount <amount>          — manually override current tips total (USD)
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { setStreamGoals, getStreamGoals, STREAM_GOALS_MODIFIED_KEY } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { bumpGoalTarget } from '@/utils/stream-goals-celebration';

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
    lower === '!cleartipsgoal' ||
    lower.startsWith('!subsgoal') ||
    lower.startsWith('!kicksgoal') ||
    lower === '!subscount' || lower.startsWith('!subscount ') ||
    lower === '!kickscount' || lower.startsWith('!kickscount ') ||
    lower.startsWith('!tipsgoal') ||
    lower === '!tipscount' || lower.startsWith('!tipscount ');

  if (!isGoalCmd) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(senderPayload, sender, broadcasterSlug)) {
    return { handled: true }; // silently ignore non-mods
  }

  const settings = (await kv.get<Record<string, unknown>>(OVERLAY_SETTINGS_KEY)) ?? {};
  const subIncrement   = Math.max(1, (settings.subGoalIncrement  as number) || 5);
  const kicksIncrement = Math.max(1, (settings.kicksGoalIncrement as number) || 100);

  /** Touch overlay_settings_modified so the SSE stream pushes updates immediately. */
  const notifyOverlay = () => void kv.set('overlay_settings_modified', Date.now()).catch(() => {});

  /** Fire-and-forget title refresh. */
  const refreshTitle = (subTarget: number, kicksTarget: number) => {
    void (async () => {
      const goals = await getStreamGoals();
      void updateKickTitleGoals(goals.subs, subTarget, goals.kicks, kicksTarget).catch(() => {});
    })();
  };

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

  // ── !cleartipsgoal ──────────────────────────────────────────────────────────
  if (lower === '!cleartipsgoal') {
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showDonationsGoal: false,
      donationsGoalTargetCents: 0,
      donationsGoalIncrementCents: 0,
      donationsGoalSubtext: null,
    });
    notifyOverlay();
    return { handled: true, reply: '✅ Tips goal cleared' };
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
    const bumped = activeTarget !== parsed.target ? ` (bumped to ${activeTarget} — already at ${goals.kicks} kicks)` : '';
    const reply = parsed.subtext
      ? `✅ Kicks goal set: ${parsed.target} kicks — "${parsed.subtext}"`
      : `✅ Kicks goal set: ${activeTarget} kicks${bumped}`;
    return { handled: true, reply };
  }

  // ── !tipsgoal <amount> [label] ──────────────────────────────────────────────
  if (lower.startsWith('!tipsgoal')) {
    const args = trimmed.slice('!tipsgoal'.length).trim();
    const parts = args.trim().split(/\s+/);
    const amount = parseFloat(parts[0]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { handled: true, reply: 'Usage: !tipsgoal <amount> [label]  e.g. !tipsgoal 100  or  !tipsgoal 100 Charity stream' };
    }
    const subtext = parts.slice(1).join(' ').trim() || undefined;
    const incrementCents = Math.round(amount * 100);
    const goals = await getStreamGoals();
    const snapped = goals.donationsCents >= incrementCents
      ? (Math.floor(goals.donationsCents / incrementCents) + 1) * incrementCents
      : incrementCents;
    const activeTarget = subtext ? incrementCents : snapped;
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showDonationsGoal: true,
      donationsGoalTargetCents: activeTarget,
      donationsGoalIncrementCents: incrementCents,
      donationsGoalSubtext: subtext ?? null,
    });
    notifyOverlay();
    const activeUsd = (activeTarget / 100).toFixed(2).replace(/\.00$/, '');
    const bumped = activeTarget !== incrementCents ? ` (bumped to $${activeUsd} — already at $${(goals.donationsCents / 100).toFixed(2).replace(/\.00$/, '')})` : '';
    const reply = subtext
      ? `✅ Tips goal set: $${amount} — "${subtext}"`
      : `✅ Tips goal set: $${activeUsd}${bumped}`;
    return { handled: true, reply };
  }

  // ── !subscount <count> ──────────────────────────────────────────────────────
  if (lower === '!subscount' || lower.startsWith('!subscount ')) {
    const arg = trimmed.slice('!subscount'.length).trim();
    const count = parseInt(arg, 10);
    if (!Number.isFinite(count) || count < 0) {
      return { handled: true, reply: 'Usage: !subscount <number>  e.g. !subscount 15' };
    }
    const prevGoals = await getStreamGoals();
    await setStreamGoals({ subs: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});

    let subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    const hasSubtext = !!(settings.subGoalSubtext as string | null | undefined);
    // Auto-iterate if no label set and the new count crosses the goal threshold
    if (subTarget > 0 && !hasSubtext && prevGoals.subs < subTarget && count >= subTarget) {
      subTarget = await bumpGoalTarget('subs', subTarget, subIncrement, count);
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
    const prevGoals = await getStreamGoals();
    await setStreamGoals({ kicks: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});

    const subTarget = (settings.subGoalTarget as number) ?? subIncrement;
    let kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    const hasKicksSubtext = !!(settings.kicksGoalSubtext as string | null | undefined);
    // Auto-iterate if no label set and the new count crosses the goal threshold
    if (kicksTarget > 0 && !hasKicksSubtext && prevGoals.kicks < kicksTarget && count >= kicksTarget) {
      kicksTarget = await bumpGoalTarget('kicks', kicksTarget, kicksIncrement, count);
    }
    notifyOverlay();
    refreshTitle(subTarget, kicksTarget);
    return { handled: true, reply: `✅ Kicks count set to ${count}` }; 
  }

  // ── !tipscount <amount> ─────────────────────────────────────────────────────
  if (lower === '!tipscount' || lower.startsWith('!tipscount ')) {
    const arg = trimmed.slice('!tipscount'.length).trim();
    const amount = parseFloat(arg);
    if (!Number.isFinite(amount) || amount < 0) {
      return { handled: true, reply: 'Usage: !tipscount <amount>  e.g. !tipscount 150.50' };
    }
    const cents = Math.round(amount * 100);
    await setStreamGoals({ donationsCents: cents });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});

    const donationsTarget = (settings.donationsGoalTargetCents as number) ?? 0;
    const donationsIncrement = (settings.donationsGoalIncrementCents as number) ?? 0;
    const hasDonationsSubtext = !!(settings.donationsGoalSubtext as string | null | undefined);
    const showDonationsGoal = !!(settings.showDonationsGoal);
    if (showDonationsGoal && !hasDonationsSubtext && donationsIncrement > 0 && donationsTarget > 0 && cents >= donationsTarget) {
      await bumpGoalTarget('donations', donationsTarget, donationsIncrement, cents);
    }

    notifyOverlay();
    return { handled: true, reply: `✅ Tips total set to $${amount.toFixed(2)}` };
  }

  return { handled: false };
}
