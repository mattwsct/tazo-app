import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { withApiAuthGet } from '@/lib/api-auth';

async function handleGET() {
  try {
    const timezone = await kv.get('overlay_timezone');
    console.log('Timezone loaded from KV:', timezone);
    
    return NextResponse.json(timezone);
  } catch (error) {
    console.error('Failed to load timezone:', error);
    return NextResponse.json(null);
  }
}

// Export protected route
export const GET = withApiAuthGet(handleGET); 