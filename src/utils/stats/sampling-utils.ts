export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
export const STALE_THRESHOLD_MS = 30 * 1000; // 30 seconds - matches overlay timeout

// Sampling intervals to prevent excessive storage
export const HEARTRATE_SAMPLE_INTERVAL = 5 * 1000; // Store heartrate every 5 seconds max
export const SPEED_SAMPLE_INTERVAL = 10 * 1000; // Store speed every 10 seconds max
export const ALTITUDE_SAMPLE_INTERVAL = 30 * 1000; // Store altitude every 30 seconds max
export const LOCATION_SAMPLE_INTERVAL = 60 * 1000; // Store location every 60 seconds max

// Maximum entries to keep (prevents KV size issues)
export const MAX_ENTRIES = 1000; // 1000 entries over 24h = ~1 entry per 1.4 minutes average

/**
 * Filters entries to only those since stream started and not after stream ended
 */
export function filterSessionEntries<T extends { timestamp: number }>(
  entries: T[],
  streamStartedAt: number | null,
  streamEndedAt: number | null
): T[] {
  if (streamStartedAt == null) return [];
  return entries.filter(
    entry => entry.timestamp >= streamStartedAt && (streamEndedAt == null || entry.timestamp <= streamEndedAt)
  );
}

/**
 * Cleans old entries (older than 24h) from array - for storage size limit only
 */
export function cleanOldEntries<T extends { timestamp: number }>(entries: T[]): T[] {
  const now = Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  return entries.filter(entry => entry.timestamp > cutoff);
}

/**
 * Formats age in human-readable format
 */
export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
