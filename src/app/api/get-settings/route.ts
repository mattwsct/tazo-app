import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';
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
          
          // Also save this data to KV storage for persistence
          const settingsWithSubGoal = {
            ...(settings || DEFAULT_OVERLAY_SETTINGS),
            _subGoalData: subGoalData
          };
          
          // Save to KV storage to ensure persistence
          await kv.set('overlay_settings', settingsWithSubGoal);
          await kv.set('overlay_settings_modified', Date.now());
          console.log('🔍 Get-settings API: Saved sub goal data to KV storage for persistence');
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
        await kv.set('overlay_settings', cleanSettings);
        await kv.set('overlay_settings_modified', Date.now());
        
        // Return clean settings without test data
        return NextResponse.json(cleanSettings);
      }
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
  
  // Verify authentication - require it for admin access
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) {
    console.warn('Unauthenticated access attempt to admin settings');
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  return handleGET();
} 