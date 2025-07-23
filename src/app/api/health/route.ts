import { NextResponse } from 'next/server';
import { validateEnvironment } from '@/lib/env-validator';

export async function GET(): Promise<NextResponse> {
  try {
    const envValidation = validateEnvironment();
    
    const healthResponse = {
      status: envValidation.isValid ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'unknown',
        hasRequiredKeys: envValidation.isValid,
        missingKeys: envValidation.missing
      }
    };
    
    return NextResponse.json(healthResponse, {
      status: envValidation.isValid ? 200 : 503,
      headers: {
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