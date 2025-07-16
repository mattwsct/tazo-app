import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { withApiAuth } from '@/lib/api-auth';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';

async function handlePOST(request: NextRequest) {
  try {
    const rawSettings = await request.json();
    
    // Detect and log any malicious keys
    const maliciousKeys = detectMaliciousKeys(rawSettings);
    if (maliciousKeys.length > 0) {
      console.warn('🚨 SECURITY ALERT: Malicious settings keys detected:', maliciousKeys);
      console.warn('🚨 Raw payload:', rawSettings);
      // Continue processing but only save validated settings
    }
    
    // Validate and sanitize the settings
    const settings = validateAndSanitizeSettings(rawSettings);
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

// Export protected route
export const POST = withApiAuth(handlePOST); 