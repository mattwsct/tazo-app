import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, checkRateLimit, getClientIP } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request);
    
    // Rate limiting: 30 location updates per minute per IP
    if (!checkRateLimit(`save-location:${clientIP}`, 30, 60000)) {
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
    
    const { label, countryCode } = await request.json();
    
    // Validate input data
    if (!label || !countryCode || typeof label !== 'string' || typeof countryCode !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid location data' }, { status: 400 });
    }
    
    await kv.set('current_location', { label, countryCode });
    console.log('Saved location to KV:', { label, countryCode });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save location error:', error);
    return NextResponse.json({ error: 'Failed to save location' }, { status: 500 });
  }
} 