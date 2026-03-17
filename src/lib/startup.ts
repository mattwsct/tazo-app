// === 🚀 STARTUP UTILITIES ===

import { logEnvironmentValidation } from './env-validator';

// Use globalThis to persist the guard across module reloads in dev (same pattern as settings-broadcast.ts)
declare global {
  var __tazoStartupValidated: boolean | undefined;
}

/**
 * Performs startup validation and logging — runs once per process.
 */
export function performStartupValidation(): void {
  if (globalThis.__tazoStartupValidated) return;
  globalThis.__tazoStartupValidated = true;

  console.log('🚀 Starting Tazo Streaming Overlay...');
  
  // Validate environment variables
  logEnvironmentValidation();
  
  // Log important startup information
  console.log(`📊 Node.js version: ${process.version}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Start time: ${new Date().toISOString()}`);
  
  // Log feature availability
  const features = {
    rtirl: !!process.env.NEXT_PUBLIC_RTIRL_PULL_KEY,
    locationiq: !!process.env.NEXT_PUBLIC_LOCATIONIQ_KEY,
    pulsoid: !!process.env.NEXT_PUBLIC_PULSOID_TOKEN,
    kv: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    auth: !!process.env.ADMIN_PASSWORD,
  };
  
  console.log('🔧 Feature availability:', features);
  
  // Warn about missing features
  const missingFeatures = Object.entries(features)
    .filter(([, available]) => !available)
    .map(([feature]) => feature);
  
  if (missingFeatures.length > 0) {
    console.warn(`⚠️ Missing features: ${missingFeatures.join(', ')}`);
  }
  
  console.log('✅ Startup validation complete');
} 