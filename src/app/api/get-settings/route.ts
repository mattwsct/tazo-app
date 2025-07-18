import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { withApiAuthGet } from '@/lib/api-auth';

// Simple KV usage tracking
let kvReadCount = 0;
let kvWriteCount = 0;

// Reset counters daily (in production, you'd want more sophisticated tracking)
declare global {
  var kvUsageReset: number | undefined;
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

async function handleGET() {
  try {
    logKVUsage('read');
    const settings = await kv.get('overlay_settings');
    console.log('Loaded overlay settings:', settings);
    return NextResponse.json(settings || {
      showLocation: true,
      showWeather: true,
      showSpeed: true,
      showTime: true,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export const GET = withApiAuthGet(handleGET); 