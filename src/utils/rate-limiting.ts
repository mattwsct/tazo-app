// === 🔄 RATE LIMITING UTILITIES ===

interface RateLimit {
  calls: number;
  lastReset: number;
  resetInterval: number;
  max: number;
  dailyCalls: number;
  dailyReset: number;
  dailyMax: number;
  lastCallTime: number; // Added for cooldown
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  openmeteo: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 1000, // 1000 per minute (16.7 per second)
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 100000, lastCallTime: 0 // Very high daily limit for Open-Meteo
  },
  locationiq: { 
    calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 5, // 5 per second (more lenient)
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 1000, lastCallTime: 0 // 1000 per day (free tier limit)
  },
  mapbox: { 
    calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 30, // 30 per minute
    dailyCalls: 0, dailyReset: Date.now(), dailyMax: 50000, lastCallTime: 0 // High daily limit for Mapbox
  },
} as const;

/**
 * Checks if API call is within rate limits (both per-second and daily)
 * Also enforces a cooldown period to prevent rapid successive calls
 */
export function checkRateLimit(api: keyof typeof RATE_LIMITS): boolean {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Enforce cooldown period (minimum 1 second between calls for LocationIQ, 0.5s for others)
  const cooldownPeriod = api === 'locationiq' ? 1000 : 500;
  if (now - limit.lastCallTime < cooldownPeriod) {
    return false;
  }
  
  // Reset per-second limits when interval expires
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  // Check if daily limit reached
  if (limit.dailyCalls >= limit.dailyMax) {
    return false;
  }
  
  // Check if per-second limit reached
  if (limit.calls >= limit.max) {
    return false;
  }
  
  limit.calls++;
  limit.dailyCalls++;
  limit.lastCallTime = now; // Update last call time
  return true;
}

/**
 * Gets remaining daily API calls for an API
 */
export function getRemainingDailyCalls(api: keyof typeof RATE_LIMITS): number {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  return Math.max(0, limit.dailyMax - limit.dailyCalls);
}

/**
 * Gets current daily API usage statistics
 */
export function getDailyUsageStats(api: keyof typeof RATE_LIMITS): {
  used: number;
  remaining: number;
  total: number;
  resetTime: string;
  percentageUsed: number;
} {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  
  // Reset daily limits at midnight
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (now - limit.dailyReset > 86400000 || limit.dailyReset < today) {
    limit.dailyCalls = 0;
    limit.dailyReset = today;
  }
  
  const used = limit.dailyCalls;
  const remaining = Math.max(0, limit.dailyMax - used);
  const percentageUsed = Math.round((used / limit.dailyMax) * 100);
  const resetTime = new Date(today + 86400000).toISOString();
  
  return {
    used,
    remaining,
    total: limit.dailyMax,
    resetTime,
    percentageUsed
  };
}
