import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled } from '@/types/kick-messages';

const KICK_MESSAGES_KEY = 'kick_message_templates';
const KICK_MESSAGE_ENABLED_KEY = 'kick_message_enabled';
const KICK_ALERT_SETTINGS_KEY = 'kick_alert_settings';

export interface KickAlertSettings {
  minimumKicks?: number;
  giftSubShowLifetimeSubs?: boolean;
}

export const DEFAULT_KICK_ALERT_SETTINGS: Required<KickAlertSettings> = {
  minimumKicks: 0,
  giftSubShowLifetimeSubs: true,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [stored, storedEnabled, storedAlert] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
      kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY),
    ]);
    const messages = { ...DEFAULT_KICK_MESSAGES, ...stored };
    const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled };
    const alertSettings = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlert };
    return NextResponse.json({ messages, enabled, alertSettings });
  } catch {
    return NextResponse.json({
      messages: DEFAULT_KICK_MESSAGES,
      enabled: DEFAULT_KICK_MESSAGE_ENABLED,
      alertSettings: DEFAULT_KICK_ALERT_SETTINGS,
    });
  }
}

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const messagesBody = body.messages as Partial<KickMessageTemplates> | undefined;
    const enabledBody = body.enabled as Partial<KickMessageEnabled> | undefined;
    const alertSettingsBody = body.alertSettings as Partial<KickAlertSettings> | undefined;
    const rest = { ...body };
    delete rest.enabled;
    delete rest.messages;
    delete rest.alertSettings;
    delete rest.action;
    const updates: Partial<KickMessageTemplates> = messagesBody ?? rest;
    const hasMessageUpdates = Object.keys(updates).length > 0;

    const hasEnabledUpdates = enabledBody && typeof enabledBody === 'object';
    const hasAlertSettingsUpdates = alertSettingsBody && typeof alertSettingsBody === 'object';

    if (hasMessageUpdates) {
      const stored = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
      const merged = { ...DEFAULT_KICK_MESSAGES, ...stored, ...updates };
      await kv.set(KICK_MESSAGES_KEY, merged);
    }

    if (hasEnabledUpdates) {
      const stored = await kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY);
      const merged = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...stored, ...enabledBody };
      await kv.set(KICK_MESSAGE_ENABLED_KEY, merged);
    }

    if (hasAlertSettingsUpdates) {
      const stored = await kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY);
      const merged = { ...DEFAULT_KICK_ALERT_SETTINGS, ...stored, ...alertSettingsBody };
      await kv.set(KICK_ALERT_SETTINGS_KEY, merged);
    }

    const [messages, enabled, alertSettings] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
      kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY),
    ]);
    return NextResponse.json({
      messages: { ...DEFAULT_KICK_MESSAGES, ...messages },
      enabled: { ...DEFAULT_KICK_MESSAGE_ENABLED, ...enabled },
      alertSettings: { ...DEFAULT_KICK_ALERT_SETTINGS, ...alertSettings },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
