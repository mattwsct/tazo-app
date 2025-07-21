import { authenticatedFetch } from '@/lib/client-auth';

// === 💾 BACKUP TYPES ===
export type BackupType = 'overlay_state';

export interface OverlayStateData {
  gps?: { lat: number; lon: number };
  location?: { 
    label: string; 
    countryCode: string; 
    originalData?: {
      city?: string;
      state?: string;
      country?: string;
      display_name?: string;
      [key: string]: unknown;
    };
  };
  weather?: { temp: number; icon: string; desc: string };
  timezone?: string;
  timestamp: number;
}

export interface BackupData {
  type: BackupType;
  data: OverlayStateData;
  timestamp: number;
}

export interface BackupResponse {
  success: boolean;
  type: BackupType;
  data?: OverlayStateData;
  timestamp?: number;
  age?: number;
  error?: string;
}

// === 💾 BACKUP UTILITIES ===

/**
 * Saves backup data to KV storage
 */
export async function saveBackup(type: BackupType, data: OverlayStateData): Promise<boolean> {
  try {
    const backupData: BackupData = {
      type,
      data,
      timestamp: Date.now()
    };
    
    const response = await authenticatedFetch('/api/backup-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backupData),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`💾 Backup save failed for ${type}:`, error);
      return false;
    }
    
    const result = await response.json();
    return result.success;
    
  } catch (error) {
    console.error(`💾 Backup save error for ${type}:`, error);
    return false;
  }
}

/**
 * Saves the entire overlay state to KV storage
 */
export async function saveOverlayState(state: {
  gps?: { lat: number; lon: number };
  location?: { 
    label: string; 
    countryCode: string; 
    originalData?: {
      city?: string;
      state?: string;
      country?: string;
      display_name?: string;
      [key: string]: unknown;
    };
  };
  weather?: { temp: number; icon: string; desc: string };
  timezone?: string;
}): Promise<boolean> {
  try {
    const overlayState: OverlayStateData = {
      ...state,
      timestamp: Date.now()
    };
    
    return await saveBackup('overlay_state', overlayState);
    
  } catch (error) {
    console.error('💾 Overlay state save error:', error);
    return false;
  }
}

/**
 * Retrieves backup data from KV storage
 */
export async function getBackup(type: BackupType): Promise<BackupResponse | null> {
  try {
    const response = await authenticatedFetch(`/api/backup-data?type=${type}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // No backup data found - this is normal
        return null;
      }
      const error = await response.text();
      console.error(`💾 Backup retrieval failed for ${type}:`, error);
      return null;
    }
    
    const result: BackupResponse = await response.json();
    return result;
    
  } catch (error) {
    console.error(`💾 Backup retrieval error for ${type}:`, error);
    return null;
  }
}

/**
 * Checks if backup data is still valid (not too old)
 */
export function isBackupValid(backup: BackupResponse, maxAgeMinutes: number): boolean {
  if (!backup.age) return false;
  
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  return backup.age < maxAgeMs;
}

/**
 * Attempts to get fresh data, falls back to backup if API fails
 * @param type The type of data to fetch
 * @param apiCall Function that returns fresh data
 * @param maxAgeMinutes Maximum age for backup data to be considered valid
 * @returns Fresh data if available, backup data if API fails, null if both fail
 */
export async function getDataWithFallback<T>(
  type: BackupType,
  apiCall: () => Promise<T | null>,
  maxAgeMinutes: number
): Promise<{ data: T | null; source: 'api' | 'backup' | 'none' }> {
  try {
    // Try to get fresh data first
    const freshData = await apiCall();
    if (freshData) {
      BackupLogger.info(type, 'Fresh data obtained from API');
      return { data: freshData, source: 'api' };
    }
  } catch (error) {
    BackupLogger.warn(type, 'API call failed, trying backup', error);
  }
  
  // API failed, try backup
  try {
    const backup = await getBackup(type);
    if (backup && backup.data && isBackupValid(backup, maxAgeMinutes)) {
      BackupLogger.info(type, 'Using backup data', { age: backup.age });
      return { data: backup.data as T, source: 'backup' };
    } else {
      BackupLogger.warn(type, 'No valid backup data available');
    }
  } catch (error) {
    BackupLogger.error(type, 'Backup retrieval failed', error);
  }
  
  return { data: null, source: 'none' };
}

/**
 * Backup frequency configuration
 */
export const BACKUP_CONFIG = {
  OVERLAY_STATE: {
    frequency: 15 * 60 * 1000, // 15 minutes
    maxAge: 240, // 4 hours
  },
} as const;

/**
 * Backup logger utility
 */
export const BackupLogger = {
  info: (type: BackupType, message: string, data?: unknown) => 
    console.log(`💾 [BACKUP ${type.toUpperCase()}] ${message}`, data || ''),
  error: (type: BackupType, message: string, error?: unknown) => 
    console.error(`💾 [BACKUP ${type.toUpperCase()} ERROR] ${message}`, error || ''),
  warn: (type: BackupType, message: string, data?: unknown) => 
    console.warn(`💾 [BACKUP ${type.toUpperCase()} WARNING] ${message}`, data || ''),
} as const; 