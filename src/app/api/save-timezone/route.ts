import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, checkRateLimit, getClientIP } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request);
    
    // Rate limiting: 30 timezone updates per minute per IP
    if (!checkRateLimit(`save-timezone:${clientIP}`, 30, 60000)) {
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
    
    const { timezone } = await request.json();
    
    // Validate timezone data
    if (!timezone || typeof timezone !== 'string' || timezone.trim().length === 0) {
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