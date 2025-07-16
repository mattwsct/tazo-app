import { NextRequest, NextResponse } from 'next/server';

// Simple API authentication using shared secret
const API_SECRET = process.env.API_SECRET || 'fallback-dev-secret-change-in-production';

export interface AuthenticatedRequest extends NextRequest {
  isAuthenticated: boolean;
}

/**
 * Validates API requests using shared secret
 * Supports both header and body authentication methods
 */
export function validateApiSecret(request: NextRequest): boolean {
  // Method 1: Check Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${API_SECRET}`) {
    return true;
  }

  // Method 2: Check X-API-Secret header (simpler)
  const apiSecretHeader = request.headers.get('x-api-secret');
  if (apiSecretHeader === API_SECRET) {
    return true;
  }

  return false;
}

/**
 * Middleware wrapper for API routes that require authentication
 * Returns 401 if authentication fails
 */
export function withApiAuth<T extends unknown[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    // Skip auth for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200 });
    }

    if (!validateApiSecret(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API secret' },
        { status: 401 }
      );
    }

    return handler(request, ...args);
  };
}

// Special wrapper for GET routes that don't need the request parameter
export function withApiAuthGet(
  handler: () => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Skip auth for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200 });
    }

    if (!validateApiSecret(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API secret' },
        { status: 401 }
      );
    }

    return handler();
  };
}

/**
 * Helper to create authenticated headers for frontend API calls
 */
export function createAuthHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-API-Secret': API_SECRET,
  };
}

/**
 * Helper for frontend to make authenticated API requests
 */
export async function authenticatedFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    ...createAuthHeaders(),
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
} 