import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
 

async function handleGET() {
  try {
    logKVUsage('read');
    const settings = await kv.get('overlay_settings');
    
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Get-settings API: Raw settings from KV:', settings);
    }
    
    // Import the default settings to ensure all properties are included
    const { DEFAULT_OVERLAY_SETTINGS } = await import('@/types/settings');
    
    const combinedSettings = {
      ...DEFAULT_OVERLAY_SETTINGS,
      ...(settings || {})
    };
    
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Get-settings API: Final combined settings:', combinedSettings);
    }
    
    return NextResponse.json(combinedSettings);
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' },
      { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Validate environment (only KV storage is required)
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    console.error('Environment validation failed:', envValidation.missing);
    return new NextResponse('Server configuration error', { status: 500 });
  }
  
  // Allow unauthenticated access for overlay (public access)
  // Authentication is only required for admin panel access
  return handleGET();
} 