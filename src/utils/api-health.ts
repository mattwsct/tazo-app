/**
 * API Health Monitoring System
 * Tracks API status and provides health indicators
 */

export interface ApiHealthStatus {
  isHealthy: boolean;
  lastSuccess: number | null;
  lastFailure: number | null;
  failureCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  isRateLimited: boolean;
  nextRetryAt: number | null;
}

export interface ApiHealthConfig {
  maxConsecutiveFailures: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  healthCheckIntervalMs: number;
}

// Default configuration
const DEFAULT_CONFIG: ApiHealthConfig = {
  maxConsecutiveFailures: 3,
  retryDelayMs: 5000, // 5 seconds
  maxRetryDelayMs: 300000, // 5 minutes
  healthCheckIntervalMs: 60000 // 1 minute
};

class ApiHealthMonitor {
  private health: Map<string, ApiHealthStatus> = new Map();
  private config: ApiHealthConfig;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<ApiHealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startHealthCheck();
  }

  /**
   * Records a successful API call
   */
  recordSuccess(apiName: string): void {
    const current = this.health.get(apiName) || this.createInitialStatus();
    
    this.health.set(apiName, {
      ...current,
      isHealthy: true,
      lastSuccess: Date.now(),
      consecutiveFailures: 0,
      lastError: null,
      isRateLimited: false,
      nextRetryAt: null
    });
  }

  /**
   * Records a failed API call
   */
  recordFailure(apiName: string, error: string, isRateLimited = false): void {
    const current = this.health.get(apiName) || this.createInitialStatus();
    const consecutiveFailures = current.consecutiveFailures + 1;
    const failureCount = current.failureCount + 1;
    
    // Calculate retry delay with exponential backoff
    const retryDelay = Math.min(
      this.config.retryDelayMs * Math.pow(2, consecutiveFailures - 1),
      this.config.maxRetryDelayMs
    );
    
    const nextRetryAt = Date.now() + retryDelay;
    
    this.health.set(apiName, {
      ...current,
      isHealthy: consecutiveFailures < this.config.maxConsecutiveFailures,
      lastFailure: Date.now(),
      failureCount,
      consecutiveFailures,
      lastError: error,
      isRateLimited,
      nextRetryAt: isRateLimited ? nextRetryAt : null
    });
  }

  /**
   * Gets the current health status for an API
   */
  getHealth(apiName: string): ApiHealthStatus {
    return this.health.get(apiName) || this.createInitialStatus();
  }

  /**
   * Checks if an API is currently available for use
   */
  canUseApi(apiName: string): boolean {
    const status = this.getHealth(apiName);
    
    // If healthy, always allow
    if (status.isHealthy) return true;
    
    // If rate limited, check if retry time has passed
    if (status.isRateLimited && status.nextRetryAt) {
      return Date.now() >= status.nextRetryAt;
    }
    
    // If too many consecutive failures, don't allow
    if (status.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return false;
    }
    
    return true;
  }

  /**
   * Gets a user-friendly status message for an API
   */
  getStatusMessage(apiName: string): string {
    const status = this.getHealth(apiName);
    
    if (status.isHealthy) {
      return `${apiName} is working normally`;
    }
    
    if (status.isRateLimited) {
      const retryIn = status.nextRetryAt ? Math.ceil((status.nextRetryAt - Date.now()) / 1000) : 0;
      return `${apiName} is rate limited. Retry in ${retryIn}s`;
    }
    
    if (status.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return `${apiName} is temporarily unavailable (${status.consecutiveFailures} consecutive failures)`;
    }
    
    if (status.lastError) {
      return `${apiName} error: ${status.lastError}`;
    }
    
    return `${apiName} status unknown`;
  }

  /**
   * Gets overall system health
   */
  getOverallHealth(): { isHealthy: boolean; unhealthyApis: string[] } {
    const unhealthyApis: string[] = [];
    
    for (const [apiName, status] of this.health.entries()) {
      if (!status.isHealthy) {
        unhealthyApis.push(apiName);
      }
    }
    
    return {
      isHealthy: unhealthyApis.length === 0,
      unhealthyApis
    };
  }

  /**
   * Resets health status for an API (useful for testing or manual recovery)
   */
  resetApi(apiName: string): void {
    this.health.set(apiName, this.createInitialStatus());
  }

  /**
   * Gets health summary for debugging
   */
  getHealthSummary(): Record<string, ApiHealthStatus> {
    const summary: Record<string, ApiHealthStatus> = {};
    for (const [apiName, status] of this.health.entries()) {
      summary[apiName] = status;
    }
    return summary;
  }

  private createInitialStatus(): ApiHealthStatus {
    return {
      isHealthy: true,
      lastSuccess: null,
      lastFailure: null,
      failureCount: 0,
      consecutiveFailures: 0,
      lastError: null,
      isRateLimited: false,
      nextRetryAt: null
    };
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  private performHealthCheck(): void {
    const now = Date.now();
    
    for (const [apiName, status] of this.health.entries()) {
      // If API has been failing for too long, reset consecutive failures
      // This allows for recovery after extended downtime
      if (!status.isHealthy && status.lastFailure) {
        const timeSinceLastFailure = now - status.lastFailure;
        const resetThreshold = this.config.maxRetryDelayMs * 2; // 2x max retry delay
        
        if (timeSinceLastFailure > resetThreshold) {
          console.log(`🔄 Resetting ${apiName} health status after extended downtime`);
          this.resetApi(apiName);
        }
      }
    }
  }

  /**
   * Cleanup method to stop health monitoring
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

// Global health monitor instance
export const apiHealthMonitor = new ApiHealthMonitor();

// Convenience functions
export function recordApiSuccess(apiName: string): void {
  apiHealthMonitor.recordSuccess(apiName);
}

export function recordApiFailure(apiName: string, error: string, isRateLimited = false): void {
  apiHealthMonitor.recordFailure(apiName, error, isRateLimited);
}

export function canUseApi(apiName: string): boolean {
  return apiHealthMonitor.canUseApi(apiName);
}

export function getApiStatusMessage(apiName: string): string {
  return apiHealthMonitor.getStatusMessage(apiName);
}

export function getOverallHealth(): { isHealthy: boolean; unhealthyApis: string[] } {
  return apiHealthMonitor.getOverallHealth();
}
