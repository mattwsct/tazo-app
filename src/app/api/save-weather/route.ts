import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, checkRateLimit, getClientIP } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request);
    
    // Rate limiting: 30 weather updates per minute per IP
    if (!checkRateLimit(`save-weather:${clientIP}`, 30, 60000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' }, 
        { status: 429 }
      );
    }
    
    // Verify admin authentication
    const isAuthenticated = await verifyAdminToken(request);
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const weather = await request.json();
    
    // Validate weather data structure
    if (!weather || typeof weather !== 'object' || 
        !weather.temp || !weather.icon || !weather.desc ||
        typeof weather.temp !== 'number' || 
        typeof weather.icon !== 'string' || 
        typeof weather.desc !== 'string') {
      return NextResponse.json({ error: 'Invalid weather data structure' }, { status: 400 });
    }
    
    await kv.set('current_weather', weather);
    console.log('Saved weather to KV:', weather);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save weather:', error);
    return NextResponse.json({ error: 'Failed to save weather' }, { status: 500 });
  }
} 