// === 📊 STATS STORAGE UTILITIES ===
// Re-export facade: all functions and types are implemented in sub-modules.
// This file maintains backward compatibility for all existing imports.

// Stream state (isStreamLive, markStreamLiveFromWebhook, etc.)
export type { StreamState } from './stats/stream-state';
export {
  STREAM_STARTED_AT_KEY,
  onStreamStarted,
  getStreamStartedAt,
  getStreamEndedAt,
  setStreamLive,
  isStreamLive,
  setStreamEndedAt,
  getStreamState,
  markStreamLiveFromWebhook,
  healStreamStateFromKickAPI,
} from './stats/stream-state';

// Heartrate storage
export type { HeartrateEntry } from './stats/heartrate-storage';
export { storeHeartrate, getHeartrateStats } from './stats/heartrate-storage';

// Speed storage
export type { SpeedEntry } from './stats/speed-storage';
export { storeSpeed, getSpeedStats } from './stats/speed-storage';

// Altitude storage
export type { AltitudeEntry } from './stats/altitude-storage';
export { storeAltitude, getAltitudeStats } from './stats/altitude-storage';

// Location storage
export type { LocationEntry } from './stats/location-storage';
export { storeLocation, getDistanceTraveled } from './stats/location-storage';
