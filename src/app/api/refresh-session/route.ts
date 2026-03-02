import { NextResponse } from 'next/server';
import { verifyAuth, generateSessionToken } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    if (!(await verifyAuth())) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const token = generateSessionToken();
    const isDev = process.env.NODE_ENV === 'development';
    const maxAge = isDev ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;

    const response = NextResponse.json({ success: true, message: 'Session refreshed' });
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
    return response;
  } catch (error) {
    console.error('Session refresh error:', error);
    return NextResponse.json({ success: false, error: 'Failed to refresh session' }, { status: 500 });
  }
}
