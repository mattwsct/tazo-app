import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const weather = await kv.get('current_weather');
    console.log('Loaded weather from KV:', weather);
    return NextResponse.json(weather);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
} 