// === 🔄 RATE LIMITING UTILITIES ===

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
  lastCallTime: number; // For cooldown
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openweathermap: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 50, // 50 per minute (well under 60/min limit)
    lastCallTime: 0
  },
  locationiq: { 
    calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 5, // 5 per second (more lenient)
    lastCallTime: 0
  },
} as const;

/**
 * Checks if API call is within rate limits (per-second only)
 * Also enforces a cooldown period to prevent rapid successive calls
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Enforce cooldown period (minimum 1 second between calls for LocationIQ, 0.5s for others)
  const cooldownPeriod = api === 'locationiq' ? 1000 : (api === 'openweathermap' ? 2000 : 500); // 2s cooldown for OpenWeatherMap
  if (now - limit.lastCallTime < cooldownPeriod) {
    return false;
  }
  
  // Reset per-second limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Check if per-second limit reached
  if (limit.calls >= limit.max) {
    return false;
  }
  
  limit.calls++;
  limit.lastCallTime = now; // Update last call time
  return true;
}

