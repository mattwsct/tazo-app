import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { withApiAuthGet } from '@/lib/api-auth';

async function handleGET() {
  try {
    const weather = await kv.get('current_weather');
    console.log('Loaded weather from KV:', weather);
    return NextResponse.json(weather);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}

// Export protected route
export const GET = withApiAuthGet(handleGET); 