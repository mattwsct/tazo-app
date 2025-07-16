import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, checkRateLimit, getClientIP } from './auth';

export interface SecureRouteOptions {
  maxRequests?: number;
  windowMs?: number;
  requireAuth?: boolean;
  rateLimitKey?: string;
}

export function withSecurity(
  handler: (request: NextRequest) => Promise<NextResponse>,
  options: SecureRouteOptions = {}
) {
  return async function securedHandler(request: NextRequest): Promise<NextResponse> {
    const {
      maxRequests = 100,
      windowMs = 60000,
      requireAuth = false,
      rateLimitKey = 'default'
    } = options;

    try {
      const clientIP = getClientIP(request);
      
      // Rate limiting
      if (!checkRateLimit(`${rateLimitKey}:${clientIP}`, maxRequests, windowMs)) {
        return NextResponse.json(
          { error: 'Too many requests. Please slow down.' }, 
          { status: 429 }
        );
      }

      // Authentication check
      if (requireAuth) {
        const isAuthenticated = await verifyAdminToken(request);
        if (!isAuthenticated) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
      }

      // Call the original handler
      return await handler(request);
    } catch (error) {
      console.error('Security middleware error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
} 