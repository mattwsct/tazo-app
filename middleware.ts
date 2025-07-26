import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if user is trying to access protected routes
  if (pathname === '/' || pathname.startsWith('/api/')) {
    // Skip authentication for login page and login API
    if (pathname === '/login' || pathname === '/api/login') {
      return NextResponse.next();
    }
    
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
  matcher: ['/', '/api/:path*', '/login']
}; 