// === 🔄 RATE LIMITING UTILITIES ===

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
  lastCallTime: number; // For cooldown
  dailyCalls?: number; // Track daily calls for APIs with daily limits
  dailyReset?: number; // Track when daily limit resets
  dailyMax?: number; // Daily maximum calls
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openweathermap: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 50, // 50 per minute (well under 60/min free tier limit)
    lastCallTime: 0,
    // Monthly limit: 1,000,000 calls/month - no daily tracking needed (very conservative usage)
  },
  locationiq: { 
    calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 1, // 1 per second (free tier limit)
    lastCallTime: 0,
    dailyCalls: 0,
    dailyReset: Date.now(),
    dailyMax: 4500, // 4,500 per day (90% of 5,000/day free tier limit - safety margin)
  },
} as const;

/**
 * Checks if API call is within rate limits (per-second and daily)
 * Also enforces a cooldown period to prevent rapid successive calls
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset per-second limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Check if per-second limit reached
  if (limit.calls >= limit.max) {
    return false;
  }
  
  // Enforce cooldown period (minimum 1 second between calls for LocationIQ, 2s for OpenWeatherMap)
  // Skip cooldown check if this is the first call (lastCallTime === 0) or if enough time has passed
  const cooldownPeriod = api === 'locationiq' ? 1000 : (api === 'openweathermap' ? 2000 : 500);
  if (limit.lastCallTime > 0 && now - limit.lastCallTime < cooldownPeriod) {
    return false;
  }
  
  // Check daily limit for LocationIQ (5,000/day free tier)
  if (api === 'locationiq' && limit.dailyMax && limit.dailyReset) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    // Reset daily counter if a day has passed
    if (now - limit.dailyReset >= oneDayMs) {
      limit.dailyCalls = 0;
      limit.dailyReset = now;
    }
    
    // Check if daily limit reached
    if (limit.dailyCalls !== undefined && limit.dailyCalls >= limit.dailyMax) {
      return false;
    }
  }
  
  // All checks passed - allow the call
  limit.calls++;
  limit.lastCallTime = now; // Update last call time
  
  // Increment daily counter for LocationIQ
  if (api === 'locationiq' && limit.dailyCalls !== undefined) {
    limit.dailyCalls++;
  }
  
  return true;
}

/**
 * Checks rate limit status WITHOUT consuming a call (for logging/debugging)
 * Returns true if a call would be allowed, false if rate limited
 */
export function canMakeApiCall(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset per-second limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    // Don't modify the actual limit object, just check
  }
  
  // Check if per-second limit reached
  const currentCalls = (now - limit.lastReset > limit.resetInterval) ? 0 : limit.calls;
  if (currentCalls >= limit.max) {
    return false;
  }
  
  // Enforce cooldown period
  const cooldownPeriod = api === 'locationiq' ? 1000 : (api === 'openweathermap' ? 2000 : 500);
  if (limit.lastCallTime > 0 && now - limit.lastCallTime < cooldownPeriod) {
    return false;
  }
  
  // Check daily limit for LocationIQ
  if (api === 'locationiq' && limit.dailyMax && limit.dailyReset) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const dailyCalls = (now - limit.dailyReset >= oneDayMs) ? 0 : (limit.dailyCalls || 0);
    
    if (dailyCalls >= limit.dailyMax) {
      return false;
    }
  }
  
  return true;
}
