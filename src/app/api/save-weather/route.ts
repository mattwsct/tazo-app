import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';

async function handlePOST(request: NextRequest) {
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

// Export protected route
export const POST = withApiAuth(handlePOST); 