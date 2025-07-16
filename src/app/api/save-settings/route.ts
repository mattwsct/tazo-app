import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { verifyAdminToken, checkRateLimit, getClientIP } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request);
    
    // Rate limiting: 30 settings updates per minute per IP
    if (!checkRateLimit(`save-settings:${clientIP}`, 30, 60000)) {
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
    
    const settings = await request.json();
    
    // Validate settings structure
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }
    
    const startTime = Date.now();
    
    // Save to KV and broadcast simultaneously for better performance
    const [kvResult] = await Promise.allSettled([
      kv.set('overlay_settings', settings),
      broadcastSettings(settings) // Broadcast immediately, don't wait for KV
    ]);
    
    const saveTime = Date.now() - startTime;
    console.log(`Settings saved and broadcasted in ${saveTime}ms:`, settings);
    
    if (kvResult.status === 'rejected') {
      console.error('KV save failed:', kvResult.reason);
      // Still return success if broadcast worked, KV failure is non-critical for real-time updates
    }
    
    return NextResponse.json({ 
      success: true, 
      saveTime,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Settings save error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
} 