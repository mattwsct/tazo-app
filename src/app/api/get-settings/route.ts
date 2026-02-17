import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
import { OverlayLogger } from '@/lib/logger';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { POLL_STATE_KEY } from '@/types/poll';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try {
    logKVUsage('read');
    const [settings, pollState] = await Promise.all([
      kv.get('overlay_settings'),
      kv.get(POLL_STATE_KEY),
    ]);

    if (process.env.NODE_ENV === 'development') {
      OverlayLogger.settings('Raw settings from KV', settings);
    }

    const combinedSettings = mergeSettingsWithDefaults({ ...(settings || {}), pollState: pollState ?? null });
    
    if (process.env.NODE_ENV === 'development') {
      OverlayLogger.settings('Final combined settings', combinedSettings);
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