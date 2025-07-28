import { NextRequest } from 'next/server';
import { kv } from '@vercel/kv';
import { getSubGoalServer } from '@/lib/sub-goal-server';
import { broadcastSettings } from '@/lib/settings-broadcast';
import { OverlayLogger } from '@/lib/logger';
import { verifyAuth } from '@/lib/api-auth';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { createErrorResponse, createSuccessResponse } from '@/utils/api-utils';

// Helper function to update settings and broadcast changes
async function updateAndBroadcastSettings(
  subGoalData: { currentSubs?: number; latestSub?: string | null; lastUpdate: number },
  logMessage: string,
  logData: Record<string, unknown>
) {
  // Get current settings and preserve existing sub goal data
  const currentSettings = await kv.get('overlay_settings') || DEFAULT_OVERLAY_SETTINGS;
  const existingSubGoalData = (currentSettings as { _subGoalData?: unknown })._subGoalData || {};
  
  const updatedSubGoalData = {
    ...existingSubGoalData,
    ...subGoalData
  };
  
  const settingsWithSubGoal = {
    ...DEFAULT_OVERLAY_SETTINGS,
    ...currentSettings,
    _subGoalData: updatedSubGoalData
  };
  
  console.log(`Manual sub update - Broadcasting settings with ${logMessage}:`, settingsWithSubGoal);
  
  // Add a small delay to ensure SSE connection is established
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const broadcastResult = await broadcastSettings(settingsWithSubGoal);
  console.log('Manual sub update - Broadcast result:', broadcastResult);
  
  // Batch KV operations to reduce calls
  await Promise.all([
    kv.set('overlay_settings', settingsWithSubGoal),
    kv.set('overlay_settings_modified', Date.now())
  ]);
  
  console.log('Manual sub update - Saved to KV storage for persistence');
  
  OverlayLogger.overlay(logMessage, logData);
}

export async function POST(request: NextRequest) {
  // Verify authentication
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) {
    return createErrorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { action, count, username, channel } = body;
    
    console.log('Manual sub update:', { action, count, username, channel });

    if (!action) {
      return createErrorResponse('Action is required');
    }

    const targetChannel = channel || 'default';
    const subGoalServer = getSubGoalServer();

    switch (action) {
      case 'update_count':
        if (typeof count !== 'number' || count < 0) {
          return createErrorResponse('Invalid count value');
        }
        
        subGoalServer.updateSubCount(targetChannel, count);
        
        await updateAndBroadcastSettings(
          { currentSubs: count, lastUpdate: Date.now() },
          'Manual sub count update',
          { channel: targetChannel, count }
        );
        
        return createSuccessResponse({ 
          message: `Sub count updated to ${count}`,
          channel: targetChannel
        });

      case 'update_latest_sub':
        if (!username || typeof username !== 'string') {
          return createErrorResponse('Valid username is required');
        }
        
        subGoalServer.updateLatestSub(targetChannel, username);
        
        await updateAndBroadcastSettings(
          { latestSub: username, lastUpdate: Date.now() },
          'Manual latest sub update',
          { channel: targetChannel, username }
        );
        
        return createSuccessResponse({ 
          message: `Latest subscriber updated to ${username}`,
          channel: targetChannel
        });

      case 'reset_goal':
        subGoalServer.resetSubGoal(targetChannel);
        
        await updateAndBroadcastSettings(
          { currentSubs: 0, latestSub: null, lastUpdate: Date.now() },
          'Manual sub goal reset',
          { channel: targetChannel }
        );
        
        return createSuccessResponse({ 
          message: 'Sub goal reset successfully',
          channel: targetChannel
        });

      default:
        return createErrorResponse('Invalid action');
    }
  } catch (error) {
    OverlayLogger.error('Manual sub update error', error);
    return createErrorResponse('Internal server error', 500);
  }
} 