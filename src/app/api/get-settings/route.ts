import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function GET() {
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