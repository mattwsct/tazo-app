import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_KICK_MESSAGES,
  DEFAULT_KICK_MESSAGE_ENABLED,
  KICK_MESSAGES_KEY,
  KICK_MESSAGE_ENABLED_KEY,
  KICK_MESSAGE_TEMPLATE_ENABLED_KEY,
  KICK_ALERT_SETTINGS_KEY,
  KICK_MESSAGE_TEMPLATES_BACKUP_KEY,
  TEMPLATE_GROUP_CONFIG,
  KICK_MESSAGE_KEYS,
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

/** Sync templates with per-template toggles: OFF → blank (and backup); ON → restore from backup or defaults. */
function syncTemplatesWithToggles(
  templates: KickMessageTemplates,
  templateEnabled: KickMessageTemplateEnabled,
  backup: Partial<KickMessageTemplates>
): { templates: KickMessageTemplates; backup: Partial<KickMessageTemplates>; changed: boolean } {
  const out = { ...templates };
  const outBackup = { ...backup };
  let changed = false;

  for (const key of KICK_MESSAGE_KEYS) {
    const isOff = templateEnabled[key] === false;
    const current = out[key];
    if (isOff) {
      if (current != null && current !== '') {
        outBackup[key] = current;
        (out as Record<string, string>)[key] = '';
        changed = true;
      }
    } else {
      if (current === '' || current == null) {
        const restored = outBackup[key] ?? DEFAULT_KICK_MESSAGES[key];
        (out as Record<string, string>)[key] = restored;
        if (key in outBackup) delete outBackup[key];
        changed = true;
      }
    }
  }
  return { templates: out, backup: outBackup, changed };
}

export interface KickChatBroadcastSettings {
  chatBroadcastLocation?: boolean;
  chatBroadcastLocationIntervalMin?: number;
  chatBroadcastHeartrate?: boolean;
  chatBroadcastHeartrateMinBpm?: number;
  chatBroadcastHeartrateVeryHighBpm?: number;
}

export interface KickAlertSettings extends KickChatBroadcastSettings {
  minimumKicks?: number;
  giftSubShowLifetimeSubs?: boolean;
}

export const DEFAULT_KICK_ALERT_SETTINGS: Required<KickAlertSettings> = {
  minimumKicks: 0,
  giftSubShowLifetimeSubs: true,
  chatBroadcastLocation: false,
  chatBroadcastLocationIntervalMin: 5,
  chatBroadcastHeartrate: false,
  chatBroadcastHeartrateMinBpm: 100,
  chatBroadcastHeartrateVeryHighBpm: 120,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [stored, storedEnabled, storedTemplateEnabled, storedAlert, storedBackup] = await Promise.all([
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
      kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
      kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
      kv.get<Partial<KickAlertSettings>>(KICK_ALERT_SETTINGS_KEY),
      kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGE_TEMPLATES_BACKUP_KEY),
    ]);
    const messages: KickMessageTemplates = { ...DEFAULT_KICK_MESSAGES, ...stored };
    const enabled = { ...DEFAULT_KICK_MESSAGE_ENABLED, ...storedEnabled };
    const templateEnabled: KickMessageTemplateEnabled = {
      ...derivedTemplateEnabled(enabled),
      ...(storedTemplateEnabled ?? {}),
    };
    const backup: Partial<KickMessageTemplates> = { ...(storedBackup ?? {}) };

    const { templates, backup: syncedBackup, changed } = syncTemplatesWithToggles(messages, templateEnabled, backup);
    if (changed) {
      await Promise.all([
        kv.set(KICK_MESSAGES_KEY, templates),
        kv.set(KICK_MESSAGE_TEMPLATES_BACKUP_KEY, syncedBackup),
      ]);
    }

    const alertSettings = { ...DEFAULT_KICK_ALERT_SETTINGS, ...storedAlert };
    return NextResponse.json({
      messages: templates,
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
      const [storedEnabled, storedTemplateEnabled, storedTemplates, storedBackup] = await Promise.all([
        kv.get<Partial<KickMessageEnabled>>(KICK_MESSAGE_ENABLED_KEY),
        kv.get<KickMessageTemplateEnabled>(KICK_MESSAGE_TEMPLATE_ENABLED_KEY),
        kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGES_KEY),
        kv.get<Partial<KickMessageTemplates>>(KICK_MESSAGE_TEMPLATES_BACKUP_KEY),
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

      const templates = { ...DEFAULT_KICK_MESSAGES, ...storedTemplates };
      const backup = { ...(storedBackup ?? {}) };
      const { templates: syncedTemplates, backup: syncedBackup } = syncTemplatesWithToggles(templates, mergedTemplateEnabled, backup);

      await Promise.all([
        kv.set(KICK_MESSAGE_ENABLED_KEY, mergedEnabled),
        kv.set(KICK_MESSAGE_TEMPLATE_ENABLED_KEY, mergedTemplateEnabled),
        kv.set(KICK_MESSAGES_KEY, syncedTemplates),
        kv.set(KICK_MESSAGE_TEMPLATES_BACKUP_KEY, syncedBackup),
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
