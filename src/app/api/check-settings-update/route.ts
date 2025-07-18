import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

// Simple KV usage tracking
let kvReadCount = 0;

// Log usage every 100 requests
function logKVUsage() {
  kvReadCount++;
  if (kvReadCount % 100 === 0) {
    console.log(`📊 KV Check Usage: ${kvReadCount} checks`);
  }
}

async function handleGET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const lastModified = url.searchParams.get('lastModified');
    
    if (!lastModified) {
      return NextResponse.json({ error: 'Missing lastModified parameter' }, { status: 400 });
    }

    logKVUsage();
    
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

export const GET = withApiAuth(handleGET); 