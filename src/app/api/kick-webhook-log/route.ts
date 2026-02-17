import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kv } from '@vercel/kv';
import { DEFAULT_KICK_MESSAGE_ENABLED, EVENT_TYPE_TO_TOGGLE } from '@/types/kick-messages';

const KICK_WEBHOOK_LOG_KEY = 'kick_webhook_log';
const KICK_WEBHOOK_DEBUG_KEY = 'kick_webhook_last_debug';
const KICK_WEBHOOK_DECISION_LOG_KEY = 'kick_webhook_decision_log';
const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [log, debug, decisionLog, storedEnabled] = await Promise.all([
      kv.lrange<{ eventType: string; at: string }[]>(KICK_WEBHOOK_LOG_KEY, 0, 19),
      kv.get<Record<string, unknown>>(KICK_WEBHOOK_DEBUG_KEY),
      kv.lrange<{ at: string; eventType: string; toggleKey: string | null; toggleValue: unknown; isDisabled: boolean; action: string; storedEnabledRaw?: unknown }[]>(KICK_WEBHOOK_DECISION_LOG_KEY, 0, 14),
      kv.get<Record<string, unknown>>(KICK_MESSAGE_ENABLED_KEY),
    ]);

    const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...(storedEnabled ?? {}) };
    const channelRewardEvent = 'channel.reward.redemption.updated';
    const toggleKey = EVENT_TYPE_TO_TOGGLE[channelRewardEvent];
    const toggleValue = toggleKey ? enabled[toggleKey] : undefined;
    const isDisabled = toggleKey && (
      toggleValue === false ||
      (toggleValue as unknown) === 0 ||
      String(toggleValue).toLowerCase() === 'false'
    );
    const diagnostic = {
      eventType: channelRewardEvent,
      toggleKey,
      toggleValue,
      isDisabled,
      storedEnabledRaw: storedEnabled ?? null,
      wouldSkip: isDisabled,
      summary: isDisabled
        ? `If we received "${channelRewardEvent}" right now, we would SKIP (toggle off)`
        : `If we received "${channelRewardEvent}" right now, we would SEND (toggle on)`,
    };

    return NextResponse.json({
      log: log ?? [],
      debug: debug ?? null,
      decisionLog: decisionLog ?? [],
      storedEnabledInKv: storedEnabled ?? null,
      diagnostic,
    });
  } catch {
    return NextResponse.json({ log: [], debug: null, decisionLog: [], storedEnabledInKv: null, diagnostic: null });
  }
}
