import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { timezone } = await request.json();
    
    if (!timezone || typeof timezone !== 'string') {
      return NextResponse.json({ error: 'Invalid timezone data' }, { status: 400 });
    }
    
    await kv.set('overlay_timezone', timezone);
    console.log('Timezone saved to KV:', timezone);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save timezone:', error);
    return NextResponse.json({ error: 'Failed to save timezone' }, { status: 500 });
  }
} 