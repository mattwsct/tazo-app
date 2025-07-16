import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const timezone = await kv.get('overlay_timezone');
    console.log('Timezone loaded from KV:', timezone);
    
    return NextResponse.json(timezone);
  } catch (error) {
    console.error('Failed to load timezone:', error);
    return NextResponse.json(null);
  }
} 