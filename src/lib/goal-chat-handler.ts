/**
 * Goal chat commands — mods and broadcaster only.
 *
 * !subsgoal <target> [subtext]   — set sub goal milestone + optional label
 * !kicksgoal <target> [subtext]  — set kicks goal milestone + optional label
 * !subs <count>                  — manually override current subs count
 * !kicks <count>                 — manually override current kicks count
 */

import { kv } from '@/lib/kv';
import { isModOrBroadcaster } from '@/lib/kick-role-check';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { setStreamGoals, STREAM_GOALS_MODIFIED_KEY } from '@/utils/stream-goals-storage';

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

export async function handleGoalCommand(
  content: string,
  sender: string,
  senderPayload: unknown
): Promise<HandleGoalCommandResult> {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  const isGoalCmd =
    lower === '!cleargoals' ||
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

  // !cleargoals — hide both goals from overlay/title and clear subtexts
  if (lower === '!cleargoals') {
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showSubGoal: false,
      showKicksGoal: false,
      subGoalSubtext: null,
      kicksGoalSubtext: null,
    });
    return { handled: true, reply: '✅ Goals hidden from overlay and titles' };
  }

  // !subsgoal <target> [subtext]
  if (lower.startsWith('!subsgoal')) {
    const args = trimmed.slice('!subsgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !subsgoal <number> [label text]  e.g. !subsgoal 20 Go to the zoo' };
    }
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showSubGoal: true,
      subGoalTarget: parsed.target,
      subGoalIncrement: parsed.target,
      subGoalSubtext: parsed.subtext ?? null,
    });
    const reply = parsed.subtext
      ? `✅ Sub goal set: ${parsed.target} subs — "${parsed.subtext}"`
      : `✅ Sub goal set: ${parsed.target} subs`;
    return { handled: true, reply };
  }

  // !kicksgoal <target> [subtext]
  if (lower.startsWith('!kicksgoal')) {
    const args = trimmed.slice('!kicksgoal'.length).trim();
    const parsed = parseGoalArgs(args);
    if (!parsed) {
      return { handled: true, reply: 'Usage: !kicksgoal <number> [label text]  e.g. !kicksgoal 5000 Shot a drink' };
    }
    await kv.set(OVERLAY_SETTINGS_KEY, {
      ...settings,
      showKicksGoal: true,
      kicksGoalTarget: parsed.target,
      kicksGoalIncrement: parsed.target,
      kicksGoalSubtext: parsed.subtext ?? null,
    });
    const reply = parsed.subtext
      ? `✅ Kicks goal set: ${parsed.target} kicks — "${parsed.subtext}"`
      : `✅ Kicks goal set: ${parsed.target} kicks`;
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
    return { handled: true, reply: `✅ Kicks count set to ${count}` };
  }

  return { handled: false };
}
