import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const weather = await request.json();
    
    if (!weather.temp || !weather.icon || !weather.desc) {
      return NextResponse.json({ error: 'Missing weather data' }, { status: 400 });
    }
    
    await kv.set('current_weather', weather);
    console.log('Saved weather to KV:', weather);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save weather:', error);
    return NextResponse.json({ error: 'Failed to save weather' }, { status: 500 });
  }
} 