import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { isValidOrigin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    // No rate limiting for overlay data endpoints - overlay needs frequent access
    
    // Validate origin to prevent abuse
    if (!isValidOrigin(request)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }
    
    const settings = await kv.get('overlay_settings');
    console.log('Loaded overlay settings:', settings);
    return NextResponse.json(settings || {
      showLocation: true,
      showWeather: true,
      showWeatherIcon: true,
      showWeatherCondition: true,
      weatherIconPosition: 'left',
      showSpeed: true,
      showTime: true,
    });
  } catch (error) {
    console.error('Failed to load settings:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
} 