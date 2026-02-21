// === 🔐 API AUTHENTICATION UTILITIES ===

import { cookies } from 'next/headers';

// Centralized admin secret configuration
export const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

/**
 * Verify authentication using HTTP-only cookie
 * Centralized authentication for all API routes
 */
export async function verifyAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth-token');
  
  if (!authToken) {
    return false;
  }
  
  // Check if the token is 'authenticated' (set by login route)
  return authToken.value === 'authenticated';
}

// === 📊 KV USAGE TRACKING ===

// Simple KV usage tracking
let kvReadCount = 0;
let kvWriteCount = 0;
let kvUsageStartTime = Date.now();

// Reset counters daily
declare global {
  var kvUsageReset: number | undefined;
}

if (typeof global !== 'undefined' && !global.kvUsageReset) {
  global.kvUsageReset = Date.now();
  kvReadCount = 0;
  kvWriteCount = 0;
  kvUsageStartTime = Date.now();
}

/**
 * Log KV usage every 100 operations
 * Centralized tracking for all API routes
 */
export function logKVUsage(operation: 'read' | 'write') {
  if (operation === 'read') kvReadCount++;
  if (operation === 'write') kvWriteCount++;
  
  const total = kvReadCount + kvWriteCount;
  const hoursSinceStart = (Date.now() - kvUsageStartTime) / (1000 * 60 * 60);
  const readsPerHour = kvReadCount / hoursSinceStart;
  const writesPerHour = kvWriteCount / hoursSinceStart;
  
  if (total % 100 === 0) {
    console.log(`📊 KV Usage: ${kvReadCount} reads, ${kvWriteCount} writes (${total} total)`);
    console.log(`📊 KV Rate: ${readsPerHour.toFixed(1)} reads/hour, ${writesPerHour.toFixed(1)} writes/hour`);
    
    // Warn if usage is high
    if (readsPerHour > 1000 || writesPerHour > 1000) {
      console.warn(`⚠️  HIGH KV USAGE: ${readsPerHour.toFixed(1)} reads/hour, ${writesPerHour.toFixed(1)} writes/hour`);
    }
  }
  
  // Monthly projection warning
  if (total % 1000 === 0) {
    const projectedReads = (kvReadCount / hoursSinceStart) * 24 * 30;
    const projectedWrites = (kvWriteCount / hoursSinceStart) * 24 * 30;
    
    if (projectedReads > 80000 || projectedWrites > 80000) {
      console.warn(`🚨 MONTHLY KV PROJECTION: ${projectedReads.toFixed(0)} reads, ${projectedWrites.toFixed(0)} writes (limit: 100,000 each)`);
    }
  }
} 