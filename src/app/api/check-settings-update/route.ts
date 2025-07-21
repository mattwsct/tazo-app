import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { verifyAuth, logKVUsage } from '@/lib/api-auth';

async function handleGET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const lastModified = url.searchParams.get('lastModified');
    
    if (!lastModified) {
      return NextResponse.json({ error: 'Missing lastModified parameter' }, { status: 400 });
    }

    logKVUsage('read');
    
    // Get the current modification timestamp
    const currentModified = await kv.get('overlay_settings_modified');
    
    // If no timestamp in KV, assume no changes
    if (!currentModified) {
      return NextResponse.json({ 
        hasChanges: false,
        lastModified: parseInt(lastModified)
      });
    }
    
    // Compare timestamps
    const lastModifiedNum = parseInt(lastModified);
    const currentModifiedNum = currentModified as number;
    
    if (currentModifiedNum <= lastModifiedNum) {
      // No changes
      return NextResponse.json({ 
        hasChanges: false,
        lastModified: currentModifiedNum
      });
    }
    
    // Changes detected - fetch the actual settings
    const settings = await kv.get('overlay_settings');
    const currentSettings = settings || DEFAULT_OVERLAY_SETTINGS;
    
    console.log(`📡 Settings change detected: ${currentModifiedNum} > ${lastModifiedNum}`);
    
    return NextResponse.json({
      hasChanges: true,
      lastModified: currentModifiedNum,
      settings: currentSettings
    });
    
  } catch (error) {
    console.error('Check settings update error:', error);
    return NextResponse.json({ error: 'Failed to check settings' }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify authentication
  if (!(await verifyAuth())) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  return handleGET(request);
} 