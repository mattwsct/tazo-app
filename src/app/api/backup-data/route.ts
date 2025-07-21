import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';

// KV usage tracking for backup operations
let backupWriteCount = 0;

declare global {
  var backupUsageReset: number | undefined;
}

if (typeof global !== 'undefined' && !global.backupUsageReset) {
  global.backupUsageReset = Date.now();
  backupWriteCount = 0;
}

function logBackupUsage() {
  backupWriteCount++;
  if (backupWriteCount % 50 === 0) {
    console.log(`📊 Backup Usage: ${backupWriteCount} backup writes`);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const backupData = await request.json();
    const { type, data, timestamp } = backupData;
    
    if (!type || !data || !timestamp) {
      return NextResponse.json({ 
        error: 'Missing required fields: type, data, timestamp' 
      }, { status: 400 });
    }
    
    // Validate backup type
    const validTypes = ['gps', 'location', 'weather', 'timezone', 'speed'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ 
        error: `Invalid backup type. Must be one of: ${validTypes.join(', ')}` 
      }, { status: 400 });
    }
    
    // Create backup key with type and timestamp
    const backupKey = `overlay_backup_${type}`;
    const backupTimestampKey = `overlay_backup_${type}_timestamp`;
    
    // Save backup data and timestamp
    await Promise.all([
      kv.set(backupKey, data),
      kv.set(backupTimestampKey, timestamp)
    ]);
    
    logBackupUsage();
    
    console.log(`💾 Backup saved: ${type}`, { 
      timestamp: new Date(timestamp).toISOString(),
      dataSize: JSON.stringify(data).length 
    });
    
    return NextResponse.json({ 
      success: true, 
      type,
      timestamp,
      message: `${type} backup saved successfully`
    });
    
  } catch (error) {
    console.error('🚨 Backup save failed:', error);
    return NextResponse.json({ 
      error: 'Failed to save backup data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function handleGET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    
    if (!type) {
      return NextResponse.json({ 
        error: 'Missing type parameter' 
      }, { status: 400 });
    }
    
    const validTypes = ['gps', 'location', 'weather', 'timezone', 'speed'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ 
        error: `Invalid backup type. Must be one of: ${validTypes.join(', ')}` 
      }, { status: 400 });
    }
    
    const backupKey = `overlay_backup_${type}`;
    const backupTimestampKey = `overlay_backup_${type}_timestamp`;
    
    // Fetch backup data and timestamp
    const [data, timestamp] = await Promise.all([
      kv.get(backupKey),
      kv.get(backupTimestampKey)
    ]);
    
    if (!data || !timestamp) {
      return NextResponse.json({ 
        error: `No backup data found for type: ${type}` 
      }, { status: 404 });
    }
    
    console.log(`📂 Backup retrieved: ${type}`, { 
      timestamp: new Date(timestamp as number).toISOString() 
    });
    
    return NextResponse.json({ 
      success: true,
      type,
      data,
      timestamp,
      age: Date.now() - (timestamp as number)
    });
    
  } catch (error) {
    console.error('🚨 Backup retrieval failed:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve backup data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const POST = withApiAuth(handlePOST);
export const GET = withApiAuth(handleGET); 