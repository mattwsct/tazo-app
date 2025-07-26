// === 🔐 CLIENT-SIDE AUTHENTICATION UTILITIES ===

/**
 * Authenticated fetch with automatic token handling
 * Uses HTTP-only cookies instead of URL parameters for security
 */
export async function authenticatedFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies automatically
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  return response;
}

/**
 * Create authenticated EventSource with automatic token handling
 * Uses HTTP-only cookies instead of URL parameters for security
 */
export function createAuthenticatedEventSource(url: string): EventSource {
  // EventSource automatically includes cookies for same-origin requests
  // The withCredentials option is not supported by EventSource
  return new EventSource(url);
}

/**
 * Login to admin panel
 * Sends credentials to server which sets HTTP-only cookie
 */
export async function loginToAdmin(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include cookies
      body: JSON.stringify({ password }),
    });
    
    const data = await response.json();
    return data;
  } catch {
    return { 
      success: false, 
      error: 'Login failed' 
    };
  }
}

/**
 * Logout from admin panel
 * Clears the authentication cookie
 */
export async function logoutFromAdmin(): Promise<{ success: boolean }> {
  try {
    const response = await fetch('/api/logout', {
      method: 'GET',
      credentials: 'include',
    });
    
    return { success: true };
  } catch {
    return { success: false };
  }
} 