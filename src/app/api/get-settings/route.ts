import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
import { OverlaySettings } from '@/types/settings';

async function handleGET() {
  try {
    logKVUsage('read');
    const settings = await kv.get('overlay_settings');
    console.log('🔍 Get-settings API: Raw settings from KV:', settings);
    
    // Import the default settings to ensure all properties are included
    const { DEFAULT_OVERLAY_SETTINGS } = await import('@/types/settings');
    
    // Get current sub goal data from the sub goal server
    let subGoalData = null;
    let shouldUpdateKV = false;
    
    try {
      const { getSubGoalServer } = await import('@/lib/sub-goal-server');
      const subGoalServer = getSubGoalServer();
      const currentData = subGoalServer.getSubGoalData('Tazo');
      if (currentData) {
        // Only use real data, not test data
        if (currentData.currentSubs > 0 || currentData.latestSub) {
          subGoalData = {
            currentSubs: currentData.currentSubs,
            latestSub: currentData.latestSub?.username || null,
            lastUpdate: Date.now()
          };
          console.log('🔍 Get-settings API: Loaded sub goal data:', subGoalData);
          
          // Check if we need to update KV (only if data is different)
          const existingSubGoalData = (settings as { _subGoalData?: unknown })?._subGoalData;
          if (!existingSubGoalData || 
              JSON.stringify(existingSubGoalData) !== JSON.stringify(subGoalData)) {
            shouldUpdateKV = true;
          }
        } else {
          console.log('🔍 Get-settings API: No real sub goal data found, skipping');
        }
      }
    } catch (error) {
      console.log('🔍 Get-settings API: Could not load sub goal data:', error);
    }
    
    // Combine settings with sub goal data
    const combinedSettings = {
      ...(settings || DEFAULT_OVERLAY_SETTINGS),
      ...(subGoalData && { _subGoalData: subGoalData })
    };
    
    // Clear any test data that might be in KV storage
    if (settings && typeof settings === 'object' && settings !== null && '_subGoalData' in settings) {
      const kvSubGoalData = (settings as { _subGoalData?: { currentSubs?: number; latestSub?: string } })._subGoalData;
      if (kvSubGoalData?.currentSubs === 999 || kvSubGoalData?.latestSub === 'TEST_USER') {
        console.log('🔍 Get-settings API: Found test data in KV, clearing it');
        const cleanSettings = { ...settings };
        delete (cleanSettings as { _subGoalData?: unknown })._subGoalData;
        
        // Update KV only when clearing test data
        await kv.set('overlay_settings', cleanSettings);
        await kv.set('overlay_settings_modified', Date.now());
        logKVUsage('write');
        
        // Return clean settings without test data
        return NextResponse.json(cleanSettings);
      }
    }
    
    // Only update KV if we have new sub goal data that's different
    if (shouldUpdateKV && subGoalData) {
      const settingsWithSubGoal = {
        ...(settings || DEFAULT_OVERLAY_SETTINGS),
        _subGoalData: subGoalData
      };
      
      // Batch KV operations to reduce calls
      await Promise.all([
        kv.set('overlay_settings', settingsWithSubGoal),
        kv.set('overlay_settings_modified', Date.now())
      ]);
      logKVUsage('write');
      console.log('🔍 Get-settings API: Updated KV with new sub goal data');
    }
    
    console.log('🔍 Get-settings API: Final combined settings:', combinedSettings);
    console.log('🔍 Get-settings API: showKickSubGoal =', (combinedSettings as OverlaySettings & { _subGoalData?: unknown }).showKickSubGoal);
    console.log('🔍 Get-settings API: kickDailySubGoal =', (combinedSettings as OverlaySettings & { _subGoalData?: unknown }).kickDailySubGoal);
    
    return NextResponse.json(combinedSettings);
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Validate environment (only KV storage is required)
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    console.error('Environment validation failed:', envValidation.missing);
    return new NextResponse('Server configuration error', { status: 500 });
  }
  
  // Allow unauthenticated access for overlay (public access)
  // Authentication is only required for admin panel access
  return handleGET();
} 