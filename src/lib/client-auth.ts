// Client-side authentication utility for frontend API calls
// Note: API_SECRET must be available on the client side via NEXT_PUBLIC_ prefix

const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || 'fallback-dev-secret-change-in-production';

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

/**
 * Helper to create EventSource with authentication headers
 * Note: EventSource doesn't support custom headers in browsers,
 * so we'll use URL parameters for SSE authentication
 */
export function createAuthenticatedEventSource(url: string): EventSource {
  // For SSE, we'll pass the secret as a URL parameter since EventSource doesn't support custom headers
  const separator = url.includes('?') ? '&' : '?';
  const authenticatedUrl = `${url}${separator}secret=${encodeURIComponent(API_SECRET)}`;
  return new EventSource(authenticatedUrl);
} 