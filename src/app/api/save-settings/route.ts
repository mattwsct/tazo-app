import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { validateAndSanitizeSettings, detectMaliciousKeys } from '@/lib/settings-validator';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { OverlayLogger } from '@/lib/logger';
import { updateKickTitleGoals } from '@/lib/stream-title-updater';
import { getStreamGoals } from '@/utils/stream-goals-storage';

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
    
    // SSE broadcast — use broadcastChallenges so runtime state
    // (timerState, challengesState, walletState, streamGoals, overlayAlerts)
    // is included alongside the new settings. Without this, toggling any
    // setting would briefly clear challenges/timer/wallet on the overlay.
    const broadcastResult = await Promise.allSettled([
      broadcastChallenges()
    ]);

    // After the KV write succeeds, fire-and-forget Supabase sync
    void (async () => {
      try {
        const { supabase: sb, isSupabaseConfigured } = await import('@/lib/supabase');
        if (!isSupabaseConfigured()) return;
        const { data: creator } = await sb.from('creators').select('id').eq('slug', 'tazo').single();
        if (!creator) return;
        await sb.from('creator_settings').upsert(
          { creator_id: creator.id, overlay: settings, updated_at: new Date().toISOString() },
          { onConflict: 'creator_id' }
        );
      } catch (e) {
        console.error('[save-settings] supabase sync error:', e);
      }
    })();

    // If either goal is shown in title, refresh title with latest counts + new targets
    const savedSettings = settings as unknown as Record<string, unknown>;
    if (savedSettings.showSubGoal || savedSettings.showKicksGoal) {
      void (async () => {
        try {
          const goals = await getStreamGoals();
          const subTarget = (savedSettings.subGoalTarget as number) ?? 5;
          const kicksTarget = (savedSettings.kicksGoalTarget as number) ?? 5000;
          await updateKickTitleGoals(goals.subs, subTarget, goals.kicks, kicksTarget);
        } catch (e) { console.warn('[save-settings] Failed to update kick title goals:', e); }
      })();
    }
    
    const broadcastSuccess = broadcastResult[0].status === 'fulfilled';
    
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