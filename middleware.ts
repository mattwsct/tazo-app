import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
  // Chat commands are public (no authentication required) - check FIRST before anything else
  // This MUST be checked before any other authentication logic
  if (pathname.startsWith('/api/chat/')) {
    // Allow all chat command routes without authentication
    return NextResponse.next();
  }
  
  // Add version parameter to overlay URL server-side to prevent OBS caching
  // This ensures the version parameter is present BEFORE OBS caches the page
  if (pathname === '/overlay') {
    const hasVersion = searchParams.has('v');
    
    if (!hasVersion) {
      // Generate a build-time version (use timestamp at build time, or current timestamp as fallback)
      // In production, this should be set as an environment variable at build time
      const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || Date.now().toString();
      
      // Rewrite URL to include version parameter (internal rewrite, not redirect)
      const url = request.nextUrl.clone();
      url.searchParams.set('v', buildVersion);
      return NextResponse.rewrite(url);
    }
  }

  // Skip authentication for public routes
  // - Login page and login API
  // - Overlay page (public, used by OBS)
  // - Overlay APIs: get-settings, settings-stream, health, get-location, update-location, stats/update
  //   (overlay runs in OBS browser source without auth cookies)
  // - Kick webhook: Kick sends server-to-server POSTs without auth cookies
  const publicRoutes = [
    '/login',
    '/api/login',
    '/overlay',
    '/api/get-settings',
    '/api/settings-stream',
    '/api/health',
    '/api/get-location',
    '/api/update-location',
    '/api/stats/update',
    '/api/kick-oauth/authorize',
    '/api/kick-oauth/callback',
    '/api/webhooks/kick',
  ];
  
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }
  
  // Check if user is trying to access protected routes
  // Exclude chat routes (already handled above)
  if (pathname === '/' || (pathname.startsWith('/api/') && !pathname.startsWith('/api/chat/'))) {
    // Check for auth cookie
    const authToken = request.cookies.get('auth-token');
    
    if (!authToken || authToken.value !== 'authenticated') {
      // Redirect to login if not authenticated
      if (pathname === '/') {
        return NextResponse.redirect(new URL('/login', request.url));
      }
      
      // Return 401 for API routes
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/api/:path*', '/login', '/overlay']
};
