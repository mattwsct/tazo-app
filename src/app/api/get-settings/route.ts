import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
import { OverlayLogger } from '@/lib/logger';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { POLL_STATE_KEY, type PollState } from '@/types/poll';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try {
    logKVUsage('read');
    const [settings, rawPollState] = await Promise.all([
      kv.get('overlay_settings'),
      kv.get<PollState | null>(POLL_STATE_KEY),
    ]);
    const pollState: PollState | null = rawPollState ?? null;
    const combinedSettings = mergeSettingsWithDefaults({ ...(settings || {}), pollState });

    // Log at most once per 30s in dev to avoid log spam (get-settings is polled frequently)
    if (process.env.NODE_ENV === 'development') {
      const now = Date.now();
      const lastLog = (globalThis as { _getSettingsLastLog?: number })._getSettingsLastLog ?? 0;
      if (now - lastLog > 30000) {
        (globalThis as { _getSettingsLastLog?: number })._getSettingsLastLog = now;
        OverlayLogger.settings('Settings loaded', { hasPollState: !!pollState });
      }
    }
    
    return NextResponse.json(combinedSettings, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' },
      { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Validate environment (only KV storage is required)
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    OverlayLogger.error('Environment validation failed', envValidation.missing);
    return new NextResponse('Server configuration error', { status: 500 });
  }
  
  // Allow unauthenticated access for overlay (public access)
  // Authentication is only required for admin panel access
  return handleGET();
} 