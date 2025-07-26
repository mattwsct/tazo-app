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

// Reset counters daily
declare global {
  var kvUsageReset: number | undefined;
}

if (typeof global !== 'undefined' && !global.kvUsageReset) {
  global.kvUsageReset = Date.now();
  kvReadCount = 0;
  kvWriteCount = 0;
}

/**
 * Log KV usage every 100 operations
 * Centralized tracking for all API routes
 */
export function logKVUsage(operation: 'read' | 'write') {
  if (operation === 'read') kvReadCount++;
  if (operation === 'write') kvWriteCount++;
  
  const total = kvReadCount + kvWriteCount;
  if (total % 100 === 0) {
    console.log(`📊 KV Usage: ${kvReadCount} reads, ${kvWriteCount} writes (${total} total)`);
  }
}

// === 🔄 GENERIC API UTILITIES ===

/**
 * Generic API wrapper with authentication and error handling
 */
export function withApiAuth<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    // Verify authentication
    if (!(await verifyAuth())) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    return handler(...args);
  };
} 