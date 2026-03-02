import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Add version parameter to overlay URL to prevent OBS browser source caching.
  // Done server-side so the version is present before OBS caches the initial load.
  if (pathname === '/overlay' && !searchParams.has('v')) {
    const url = request.nextUrl.clone();
    url.searchParams.set('v', process.env.NEXT_PUBLIC_BUILD_VERSION || Date.now().toString());
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/overlay'],
};
