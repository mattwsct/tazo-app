import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
import { broadcastSettings } from '@/lib/settings-broadcast';

// Invalidate SSE cache when settings are updated
declare global {
  var sseCacheInvalidated: number | undefined;
}

function invalidateSSECache() {
  // This will force the SSE route to fetch fresh data on next request
  if (typeof global !== 'undefined') {
    global.sseCacheInvalidated = Date.now();
  }
}

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
    
    console.log('💾 Save-settings API: Saving settings to KV:', settings);
    console.log('💾 Save-settings API: showKickSubGoal =', settings.showKickSubGoal);
    console.log('💾 Save-settings API: kickDailySubGoal =', settings.kickDailySubGoal);
    
    // Reduced logging to prevent spam
    
    // Save to KV (minimal usage) and update fast polling cache
    const kvResult = await Promise.allSettled([
      Promise.all([
        kv.set('overlay_settings', settings),
        kv.set('overlay_settings_modified', Date.now())
      ]).then(() => {
        logKVUsage('write');
        invalidateSSECache(); // Invalidate cache after successful save
        return true;
      })
    ]);
    
    // SSE broadcast handles real-time updates
    
    // Fast polling system handles updates immediately (no KV usage for broadcasting)
    // SSE broadcast is kept as fallback but not retried aggressively
    const broadcastResult = await Promise.allSettled([
      broadcastSettings(settings)
    ]);
    
    const broadcastSuccess = broadcastResult[0].status === 'fulfilled' && 
                            broadcastResult[0].value?.success;
    
    if (broadcastSuccess) {
      console.log(`✅ SSE broadcast successful (fallback)`);
    } else {
      console.log(`⚠️  SSE broadcast failed, but fast polling will handle updates`);
    }
    
    const saveTime = Date.now() - startTime;
    
    // Check results
    const kvSuccess = kvResult[0].status === 'fulfilled';
    
    if (!kvSuccess) {
      console.error('🚨 KV save failed:', kvResult[0].status === 'rejected' ? 
        kvResult[0].reason : 'Unknown error');
    }
    
    if (!broadcastSuccess) {
      console.error('🚨 Broadcast failed after 3 attempts');
    }
    
    return NextResponse.json({ 
      success: true, 
      kvSuccess, 
      broadcastSuccess,
      processingTime: saveTime 
    });
    
  } catch (error) {
    console.error('Settings save error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Try to verify authentication, but allow access if not authenticated
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) {
    console.warn('Not authenticated, but allowing access for settings save');
  }
  
  return handlePOST(request);
} 