import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Add version parameter to overlay URLs to prevent OBS browser source caching.
  // Matches /overlay and /overlay/[creator]
  const isOverlay = pathname === '/overlay' || pathname.startsWith('/overlay/');
  if (isOverlay && !searchParams.has('v')) {
    const url = request.nextUrl.clone();
    url.searchParams.set('v', process.env.NEXT_PUBLIC_BUILD_VERSION || Date.now().toString());
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/overlay', '/overlay/:path*'],
};
