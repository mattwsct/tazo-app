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
    const [kvResult, broadcastResult] = await Promise.allSettled([
      kv.set('overlay_settings', settings),
      broadcastSettings(settings) // Broadcast immediately, don't wait for KV
    ]);
    
    const saveTime = Date.now() - startTime;
    console.log(`Settings processed in ${saveTime}ms:`, settings);
    
    // Check results
    const kvSuccess = kvResult.status === 'fulfilled';
    const broadcastSuccess = broadcastResult.status === 'fulfilled' && 
                            broadcastResult.value?.success;
    
    if (!kvSuccess) {
      console.error('🚨 KV save failed:', kvResult.reason);
    }
    
    if (!broadcastSuccess) {
      console.error('🚨 Broadcast failed:', broadcastResult.status === 'rejected' ? 
        broadcastResult.reason : broadcastResult.value);
    }
    
    // Log broadcast details if successful
    if (broadcastSuccess) {
      const details = broadcastResult.value;
      console.log(`📡 Broadcast: ${details.successCount} sent, ${details.failureCount} failed, ${details.activeConnections} active`);
    }
    
    return NextResponse.json({ 
      success: kvSuccess || broadcastSuccess, // Success if either works
      kvSaved: kvSuccess,
      broadcastSent: broadcastSuccess,
      broadcastDetails: broadcastSuccess ? broadcastResult.value : null,
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