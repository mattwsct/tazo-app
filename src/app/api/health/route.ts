import { NextResponse } from 'next/server';
import { validateEnvironment } from '@/lib/env-validator';
import { kv } from '@vercel/kv';

export async function GET(): Promise<NextResponse> {
  try {
    const envValidation = validateEnvironment();
    let kvOk = false;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      try {
        await kv.get('health_ping');
        kvOk = true;
      } catch {
        kvOk = false;
      }
    }

    const status = envValidation.isValid && kvOk ? 'healthy' : 'degraded';
    const healthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'unknown',
        hasRequiredKeys: envValidation.isValid,
        missingKeys: envValidation.missing,
        kvReachable: kvOk
      }
    };

    return NextResponse.json(healthResponse, {
      status: status === 'healthy' ? 200 : 503,
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