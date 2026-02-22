import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
  KICK_MESSAGES_KEY,
  KICK_MESSAGE_ENABLED_KEY,
  KICK_MESSAGE_TEMPLATE_ENABLED_KEY,
  KICK_ALERT_SETTINGS_KEY,
  TEMPLATE_GROUP_CONFIG,
} from '@/types/kick-messages';
import type { KickMessageTemplates, KickMessageEnabled, KickMessageTemplateEnabled } from '@/types/kick-messages';

/** Derive per-template enabled from group-level (for migration when templateEnabled not set). */
function derivedTemplateEnabled(groupEnabled: KickMessageEnabled): KickMessageTemplateEnabled {
  const out: KickMessageTemplateEnabled = {};
  for (const group of TEMPLATE_GROUP_CONFIG) {
    const on = groupEnabled[group.toggleKey] !== false;
    for (const key of group.templateKeys) {
      out[key as keyof KickMessageTemplates] = on;
    }
  }
  return out;
}

export interface KickChatBroadcastSettings {
  chatBroadcastStreamTitle?: boolean;
  chatBroadcastLocation?: boolean;
  chatBroadcastLocationIntervalMin?: number;
  chatBroadcastWeather?: boolean;
  chatBroadcastHeartrate?: boolean;
  chatBroadcastHeartrateMinBpm?: number;
  chatBroadcastHeartrateVeryHighBpm?: number;
  chatBroadcastSpeed?: boolean;
  chatBroadcastSpeedMinKmh?: number;
  chatBroadcastSpeedTimeoutMin?: number;
  chatBroadcastAltitude?: boolean;
  chatBroadcastAltitudeMinM?: number;
  chatBroadcastAltitudeTimeoutMin?: number;
  chatBroadcastWellnessSteps?: boolean;
  chatBroadcastWellnessDistance?: boolean;
  chatBroadcastWellnessFlights?: boolean;
  chatBroadcastWellnessActiveCalories?: boolean;
}

export interface KickAlertSettings extends KickChatBroadcastSettings {
  minimumKicks?: number;
}

export const DEFAULT_KICK_ALERT_SETTINGS: Required<KickAlertSettings> = {
  minimumKicks: 0,
  chatBroadcastStreamTitle: false,
  chatBroadcastLocation: false,
  chatBroadcastLocationIntervalMin: 5,
  chatBroadcastWeather: false,
  chatBroadcastHeartrate: false,
  chatBroadcastHeartrateMinBpm: 100,
  chatBroadcastHeartrateVeryHighBpm: 120,
  chatBroadcastSpeed: false,
  chatBroadcastSpeedMinKmh: 20,
  chatBroadcastSpeedTimeoutMin: 5,
  chatBroadcastAltitude: false,
  chatBroadcastAltitudeMinM: 50,
  chatBroadcastAltitudeTimeoutMin: 5,
  chatBroadcastWellnessSteps: false,
  chatBroadcastWellnessDistance: false,
  chatBroadcastWellnessFlights: false,
  chatBroadcastWellnessActiveCalories: false,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [stored, storedEnabled, storedTemplateEnabled, storedAlert] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
      kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
      kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY),
    ]);
    const messages: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...stored };
    const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled };
    const templateEnabled: KickMessageTemplateEnabled = {
      ...derivedTemplateEnabled(enabled),
      ...(storedTemplateEnabled ?? {}),
    };
    const alertSettings = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlert };
    return NextResponse.json({
      messages,
      enabled,
      templateEnabled,
      alertSettings,
      storedEnabledRaw: storedEnabled ?? null,
    });
  } catch {
    return NextResponse.json({
      messages: DEFAULT_KICK_MESSAGES,
      enabled: DEFAULT_KICK_MESSAGE_ENABLED,
      templateEnabled: derivedTemplateEnabled(DEFAULT_KICK_MESSAGE_ENABLED),
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
    const templateEnabledBody = body.templateEnabled as KickMessageTemplateEnabled | undefined;
    const alertSettingsBody = body.alertSettings as Partial<KickAlertSettings> | undefined;
    const rest = { ...body };
    delete rest.enabled;
    delete rest.messages;
    delete rest.templateEnabled;
    delete rest.alertSettings;
    delete rest.action;
    const updates: Partial<KickMessageTemplates> = messagesBody ?? rest;
    const hasMessageUpdates = Object.keys(updates).length > 0;

    const hasEnabledUpdates = enabledBody && typeof enabledBody === 'object';
    const hasTemplateEnabledUpdates = templateEnabledBody && typeof templateEnabledBody === 'object';
    const hasAlertSettingsUpdates = alertSettingsBody && typeof alertSettingsBody === 'object';

    if (hasMessageUpdates) {
      const stored = await kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY);
      const merged = { ...DEFAULT_KICK_MESSAGES, ...stored, ...updates };
      await kv.set(KICK_MESSAGES_KEY, merged);
    }

    if (hasEnabledUpdates || hasTemplateEnabledUpdates) {
      const [storedEnabled, storedTemplateEnabled] = await Promise.all([
        kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
        kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
      ]);

      const mergedEnabled: KickMessageEnabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled, ...(enabledBody ?? {}) };
      for (const k of Object.keys(mergedEnabled) as (keyof KickMessageEnabled)[]) {
        const v = mergedEnabled[k] as unknown;
        if (String(v) === 'false') mergedEnabled[k] = false;
        else if (String(v) === 'true') mergedEnabled[k] = true;
      }

      const mergedTemplateEnabled: KickMessageTemplateEnabled = {
        ...derivedTemplateEnabled(mergedEnabled),
        ...(storedTemplateEnabled ?? {}),
        ...(templateEnabledBody ?? {}),
      };

      await Promise.all([
        kv.set(KICK_MESSAGE_ENABLED_KEY, mergedEnabled),
        kv.set(KICK_MESSAGE_TEMPLATE_ENABLED_KEY, mergedTemplateEnabled),
      ]);
    }

    if (hasAlertSettingsUpdates) {
      const stored = await kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY);
      const merged = { ...DEFAULT_KICK_ALERT_SETTINGS, ...stored, ...alertSettingsBody };
      await kv.set(KICK_ALERT_SETTINGS_KEY, merged);
    }

    const [messages, enabled, templateEnabled, alertSettings] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
      kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
      kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY),
    ]);
    const resolvedTemplateEnabled: KickMessageTemplateEnabled = {
      ...derivedTemplateEnabled({ ...DEFAULT_KICK_MESSAGE_ENABLED, ...enabled }),
      ...(templateEnabled ?? {}),
    };
    return NextResponse.json({
      messages: { ...DEFAULT_KICK_MESSAGES, ...messages },
      enabled: { ...DEFAULT_KICK_MESSAGE_ENABLED, ...enabled },
      templateEnabled: resolvedTemplateEnabled,
      alertSettings: { ...DEFAULT_KICK_ALERT_SETTINGS, ...alertSettings },
      storedEnabledRaw: enabled ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
