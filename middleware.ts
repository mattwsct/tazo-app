import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
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
  // - Public API endpoints needed by overlay (get-settings, settings-stream, health)
  const publicRoutes = [
    '/login',
    '/api/login',
    '/overlay',
    '/api/get-settings',
    '/api/settings-stream',
    '/api/health'
  ];
  
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }
  
  // Check if user is trying to access protected routes
  if (pathname === '/' || pathname.startsWith('/api/')) {
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