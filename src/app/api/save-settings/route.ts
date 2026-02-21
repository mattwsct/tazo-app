import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { OverlayLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

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
      OverlayLogger.warn('SECURITY ALERT: Malicious settings keys detected', maliciousKeys);
      // Continue processing but only save validated settings
    }
    
    // Validate and sanitize the settings
    const settings = validateAndSanitizeSettings(rawSettings);
    
    const startTime = Date.now();
    
    // Batch KV operations to reduce calls
    const kvResult = await Promise.allSettled([
      Promise.all([
        kv.set('overlay_settings', settings),
        kv.set('overlay_settings_modified', Date.now())
      ]).then(() => {
        logKVUsage('write');
        invalidateSSECache();
        return true;
      }).catch((error) => {
        OverlayLogger.error('KV operation failed', error);
        throw error;
      })
    ]);
    
    // SSE broadcast handles real-time updates
    const broadcastResult = await Promise.allSettled([
      broadcastSettings(settings)
    ]);
    
    const broadcastSuccess = broadcastResult[0].status === 'fulfilled' && 
                            broadcastResult[0].value?.success;
    
    const saveTime = Date.now() - startTime;
    
    // Check results
    const kvSuccess = kvResult[0].status === 'fulfilled';
    
    if (!kvSuccess) {
      OverlayLogger.error('KV save failed', kvResult[0].status === 'rejected' ? 
        kvResult[0].reason : 'Unknown error');
    }
    
    return NextResponse.json({ 
      success: true, 
      kvSuccess, 
      broadcastSuccess,
      processingTime: saveTime 
    });
    
  } catch (error) {
    OverlayLogger.error('Settings save error', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify authentication - require it for admin access
  const isAuthenticated = await verifyAuth();
  
  if (!isAuthenticated) {
    OverlayLogger.warn('Unauthenticated access attempt to save settings');
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  return handlePOST(request);
} 