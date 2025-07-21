import { NextResponse } from 'next/server';
import { validateEnvironment } from '@/lib/env-validator';

// === 🏥 HEALTH CHECK TYPES ===
interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'down';
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  services: {
    rtirl: ServiceStatus;
    locationiq: ServiceStatus;
    openmeteo: ServiceStatus;
    kv: ServiceStatus;
  };
  environment: {
    nodeEnv: string;
    hasRequiredKeys: boolean;
    missingKeys: string[];
  };
}

// === 🔍 SERVICE CHECK FUNCTIONS ===
async function checkRTIRLStatus(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    // Simple check - try to access RTIRL documentation or status
    const response = await fetch('https://realtimeirl.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: response.ok ? 'healthy' : 'degraded',
      responseTime,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString()
    };
  }
}

async function checkLocationIQStatus(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    // Check LocationIQ status page or documentation
    const response = await fetch('https://locationiq.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: response.ok ? 'healthy' : 'degraded',
      responseTime,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString()
    };
  }
}

async function checkOpenMeteoStatus(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    // Check Open-Meteo status
    const response = await fetch('https://api.open-meteo.com/v1/status', {
      signal: AbortSignal.timeout(5000)
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      return {
        status: data.status === 'ok' ? 'healthy' : 'degraded',
        responseTime,
        lastChecked: new Date().toISOString()
      };
    }
    
    return {
      status: 'degraded',
      responseTime,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString()
    };
  }
}

async function checkKVStatus(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    // Try to access KV storage (this would need to be implemented based on your KV setup)
    // For now, we'll assume it's healthy if we can reach this point
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString()
    };
  }
}

function checkEnvironment(): { hasRequiredKeys: boolean; missingKeys: string[] } {
  const envValidation = validateEnvironment();
  
  return {
    hasRequiredKeys: envValidation.isValid,
    missingKeys: envValidation.missing
  };
}

// === 🏥 HEALTH CHECK ENDPOINT ===
export async function GET(): Promise<NextResponse> {
  try {
    const startTime = Date.now();
    
    // Check all services in parallel
    const [rtirl, locationiq, openmeteo, kv] = await Promise.allSettled([
      checkRTIRLStatus(),
      checkLocationIQStatus(),
      checkOpenMeteoStatus(),
      checkKVStatus()
    ]);
    
    const environment = checkEnvironment();
    
    // Determine overall status
    const services = {
      rtirl: rtirl.status === 'fulfilled' ? rtirl.value : {
        status: 'down' as const,
        error: 'Service check failed',
        lastChecked: new Date().toISOString()
      },
      locationiq: locationiq.status === 'fulfilled' ? locationiq.value : {
        status: 'down' as const,
        error: 'Service check failed',
        lastChecked: new Date().toISOString()
      },
      openmeteo: openmeteo.status === 'fulfilled' ? openmeteo.value : {
        status: 'down' as const,
        error: 'Service check failed',
        lastChecked: new Date().toISOString()
      },
      kv: kv.status === 'fulfilled' ? kv.value : {
        status: 'down' as const,
        error: 'Service check failed',
        lastChecked: new Date().toISOString()
      }
    };
    
    // Determine overall health status
    const serviceStatuses = Object.values(services).map(s => s.status);
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    
    if (serviceStatuses.includes('down')) {
      overallStatus = 'down';
    } else if (serviceStatuses.includes('degraded')) {
      overallStatus = 'degraded';
    }
    
    if (!environment.hasRequiredKeys) {
      overallStatus = 'degraded';
    }
    
    const healthResponse: HealthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'unknown',
        ...environment
      }
    };
    
    const responseTime = Date.now() - startTime;
    
    return NextResponse.json(healthResponse, {
      status: overallStatus === 'down' ? 503 : 200,
      headers: {
        'X-Response-Time': `${responseTime}ms`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    
  } catch (error) {
    return NextResponse.json({
      status: 'down',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 