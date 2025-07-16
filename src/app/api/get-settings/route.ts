import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { withApiAuthGet } from '@/lib/api-auth';

async function handleGET() {
  try {
    const settings = await kv.get('overlay_settings');
    console.log('Loaded overlay settings:', settings);
    return NextResponse.json(settings || {
      showLocation: true,
      showWeather: true,
      showSpeed: true,
      showTime: true,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// Export protected route
export const GET = withApiAuthGet(handleGET); 