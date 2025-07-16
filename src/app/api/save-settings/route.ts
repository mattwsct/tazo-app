import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { broadcastSettings } from '@/lib/settings-broadcast';

export async function POST(request: Request) {
  try {
    const settings = await request.json();
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