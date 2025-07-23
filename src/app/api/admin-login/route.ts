import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { password } = await request.json();
    
    if (!password || !ADMIN_PASSWORD) {
      return NextResponse.json(
        { success: false, error: 'Admin password not configured. Please set ADMIN_PASSWORD environment variable.' },
        { status: 401 }
      );
    }
    
    // Check user password
    if (password === ADMIN_PASSWORD) {
      const cookieStore = await cookies();
      
      // Set HTTP-only cookie with the internal secret for API authentication
      cookieStore.set('admin-auth', ADMIN_SECRET || ADMIN_PASSWORD, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24, // 24 hours
        path: '/',
      });
      
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
} 