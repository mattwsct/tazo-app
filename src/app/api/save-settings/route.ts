import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';

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
    
    console.log('🔄 Starting settings save and broadcast process...');
    
    // Save to KV first, then broadcast with a small delay to ensure SSE connection is ready
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
    
    // Small delay to ensure SSE connection is established
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Now broadcast the settings
    const broadcastResult = await Promise.allSettled([
      broadcastSettings(settings)
    ]);
    
    const saveTime = Date.now() - startTime;
    console.log(`⚡ Settings processed in ${saveTime}ms:`, settings);
    
    // Check results
    const kvSuccess = kvResult[0].status === 'fulfilled';
    const broadcastSuccess = broadcastResult[0].status === 'fulfilled' && 
                            broadcastResult[0].value?.success;
    
    if (!kvSuccess) {
      console.error('🚨 KV save failed:', kvResult[0].status === 'rejected' ? 
        kvResult[0].reason : 'Unknown error');
    } else {
      console.log('✅ KV save successful');
    }
    
    if (!broadcastSuccess) {
      console.error('🚨 Broadcast failed:', broadcastResult[0].status === 'rejected' ? 
        broadcastResult[0].reason : broadcastResult[0].value);
    } else {
      console.log('✅ Broadcast successful');
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