import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { withApiAuth } from '@/lib/api-auth';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';

// Simple KV usage tracking
let kvReadCount = 0;
let kvWriteCount = 0;

// Reset counters daily
declare global {
  var kvUsageReset: number | undefined;
  var sseCacheInvalidated: number | undefined;
}

if (typeof global !== 'undefined' && !global.kvUsageReset) {
  global.kvUsageReset = Date.now();
  kvReadCount = 0;
  kvWriteCount = 0;
}

// Log usage every 100 requests
function logKVUsage(operation: 'read' | 'write') {
  if (operation === 'read') kvReadCount++;
  if (operation === 'write') kvWriteCount++;
  
  const total = kvReadCount + kvWriteCount;
  if (total % 100 === 0) {
    console.log(`📊 KV Usage: ${kvReadCount} reads, ${kvWriteCount} writes (${total} total)`);
  }
}

// Invalidate SSE cache when settings are updated
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
    
    // Save to KV and broadcast simultaneously for better performance
    const [kvResult, broadcastResult] = await Promise.allSettled([
      Promise.all([
        kv.set('overlay_settings', settings),
        kv.set('overlay_settings_modified', Date.now())
      ]).then(() => {
        logKVUsage('write');
        invalidateSSECache(); // Invalidate cache after successful save
        return true;
      }),
      broadcastSettings(settings) // Broadcast immediately, don't wait for KV
    ]);
    
    const saveTime = Date.now() - startTime;
    console.log(`⚡ Settings processed in ${saveTime}ms:`, settings);
    
    // Check results
    const kvSuccess = kvResult.status === 'fulfilled';
    const broadcastSuccess = broadcastResult.status === 'fulfilled' && 
                            broadcastResult.value?.success;
    
    if (!kvSuccess) {
      console.error('🚨 KV save failed:', kvResult.reason);
    } else {
      console.log('✅ KV save successful');
    }
    
    if (!broadcastSuccess) {
      console.error('🚨 Broadcast failed:', broadcastResult.status === 'rejected' ? 
        broadcastResult.reason : broadcastResult.value);
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

export const POST = withApiAuth(handlePOST); 