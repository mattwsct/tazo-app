import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { lat, lon, timestamp } = await request.json();
    
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return NextResponse.json({ error: 'Invalid GPS coordinates' }, { status: 400 });
    }
    
    const gpsData = {
      lat,
      lon,
      timestamp: timestamp || Date.now()
    };
    
    await kv.set('current_gps', gpsData);
    console.log('Saved GPS coordinates to KV:', gpsData);
    
    return NextResponse.json({ success: true, gpsData });
  } catch (error) {
    console.error('Failed to save GPS coordinates:', error);
    return NextResponse.json({ error: 'Failed to save GPS coordinates' }, { status: 500 });
  }
} 