import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { withApiAuthGet } from '@/lib/api-auth';

async function handleGET() {
  try {
    const location = await kv.get('current_location');
    console.log('Loaded location from KV:', location);
    return NextResponse.json(location);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}

// Export protected route
export const GET = withApiAuthGet(handleGET); 