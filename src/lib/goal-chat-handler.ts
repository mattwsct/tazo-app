/**
 * Goal chat commands — mods and broadcaster only.
 *
 * !subsgoal <target> [subtext]   — set/replace sub goal milestone + optional label
 * !kicksgoal <target> [subtext]  — set/replace kicks goal milestone + optional label
 * !clearsubsgoal                 — hide sub goal, reset target to saved increment
 * !clearkicksgoal                — hide kicks goal, reset target to saved increment
 * !cleargoals                    — hide both goals, reset both targets to saved increments
 * !subs <count>                  — manually override current subs count
 * !kicks <count>                 — manually override current kicks count
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { setStreamGoals, getStreamGoals, STREAM_GOALS_MODIFIED_KEY } from '@/utils/stream-goals-storage';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';

const OVERLAY_SETTINGS_KEY = 'overlay_settings';

export interface HandleGoalCommandResult {
  handled: boolean;
  reply?: string;
}

/** Parse "!subsgoal 20 Go to the zoo" → { target: 20, subtext: "Go to the zoo" } */
function parseGoalArgs(args: string): { target: number; subtext: string | undefined } | null {
  const parts = args.trim().split(/\s+/);
  const target = parseInt(parts[0], 10);
  if (!Number.isFinite(target) || target < 1) return null;
  const subtext = parts.slice(1).join(' ').trim() || undefined;
  return { target, subtext };
}

/**
 * Compute the effective starting target: if currentCount already meets or exceeds
 * the requested target, bump up in multiples of increment until strictly above count.
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
    lower === '!subs' || lower.startsWith('!subs ') ||
    lower === '!kicks' || lower.startsWith('!kicks ');

  if (!isGoalCmd) return { handled: false };

  const broadcasterSlug = await kv.get<string>(KICK_BROADCASTER_SLUG_KEY);
  if (!isModOrBroadcaster(senderPayload, sender, broadcasterSlug)) {
    return { handled: true }; // silently ignore non-mods
  }

  const settings = (await kv.get<Record<string, unknown>>(OVERLAY_SETTINGS_KEY)) ?? {};
  const subIncrement  = Math.max(1, (settings.subGoalIncrement  as number) || 5);
  const kicksIncrement = Math.max(1, (settings.kicksGoalIncrement as number) || 100);

  // Helper: touch overlay_settings_modified so the SSE stream pushes the update immediately
  const notifyOverlay = () => void kv.set('overlay_settings_modified', Date.now()).catch(() => {});

  // Helper: fire-and-forget title refresh
  const refreshTitle = (subTarget: number, kicksTarget: number) => {
    void (async () => {
      const goals = await getStreamGoals();
      void updateKickTitleGoals(goals.subs, subTarget, goals.kicks, kicksTarget).catch(() => {});
    })();
  };

  // !clearsubsgoal — hide sub goal, reset target back to saved increment
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

  // !clearkicksgoal — hide kicks goal, reset target back to saved increment
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

  // !cleargoals — hide both, reset both targets back to saved increments
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

  // !subsgoal <target> [subtext]
  if (lower.startsWith('!subsgoal')) {
    const args = trimmed.slice('!subsgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !subsgoal <number> [label text]  e.g. !subsgoal 20 Go to the zoo' };
    }
    const goals = await getStreamGoals();
    // Only auto-bump to next multiple when there's no subtext — with subtext the goal is fixed
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

  // !kicksgoal <target> [subtext]
  if (lower.startsWith('!kicksgoal')) {
    const args = trimmed.slice('!kicksgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !kicksgoal <number> [label text]  e.g. !kicksgoal 5000 Shot a drink' };
    }
    const goals = await getStreamGoals();
    // Only auto-bump to next multiple when there's no subtext — with subtext the goal is fixed
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

  // !subs <count>
  if (lower === '!subs' || lower.startsWith('!subs ')) {
    const arg = trimmed.slice('!subs'.length).trim();
    const count = parseInt(arg, 10);
    if (!Number.isFinite(count) || count < 0) {
      return { handled: true, reply: 'Usage: !subs <number>  e.g. !subs 15' };
    }
    await setStreamGoals({ subs: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
    const subTarget  = (settings.subGoalTarget  as number) ?? subIncrement;
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    refreshTitle(subTarget, kicksTarget);
    return { handled: true, reply: `✅ Subs count set to ${count}` };
  }

  // !kicks <count>
  if (lower === '!kicks' || lower.startsWith('!kicks ')) {
    const arg = trimmed.slice('!kicks'.length).trim();
    const count = parseInt(arg, 10);
    if (!Number.isFinite(count) || count < 0) {
      return { handled: true, reply: 'Usage: !kicks <number>  e.g. !kicks 1500' };
    }
    await setStreamGoals({ kicks: count });
    void kv.set(STREAM_GOALS_MODIFIED_KEY, Date.now()).catch(() => {});
    const subTarget  = (settings.subGoalTarget  as number) ?? subIncrement;
    const kicksTarget = (settings.kicksGoalTarget as number) ?? kicksIncrement;
    refreshTitle(subTarget, kicksTarget);
    return { handled: true, reply: `✅ Kicks count set to ${count}` };
  }

  return { handled: false };
}
