import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';

async function handleGET() {
  try {
    logKVUsage('read');
    const settings = await kv.get('overlay_settings');
    console.log('Loaded overlay settings:', settings);
    return NextResponse.json(settings || {
      locationDisplay: 'city',
      showWeather: true,
      showMinimap: false,
      minimapSpeedBased: false,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Validate environment
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    console.error('Environment validation failed:', envValidation.missing);
    return new NextResponse('Server configuration error', { status: 500 });
  }
  
  // Verify authentication
  if (!(await verifyAuth())) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  return handleGET();
} 