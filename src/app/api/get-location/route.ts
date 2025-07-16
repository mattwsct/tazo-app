import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const location = await kv.get('current_location');
    console.log('Loaded location from KV:', location);
    return NextResponse.json(location);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
} 