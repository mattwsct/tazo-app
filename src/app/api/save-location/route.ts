import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { label, countryCode } = await request.json();
    if (!label || !countryCode) {
      return NextResponse.json({ error: 'Missing location data' }, { status: 400 });
    }
    await kv.set('current_location', { label, countryCode });
    console.log('Saved location to KV:', { label, countryCode });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save location' }, { status: 500 });
  }
} 