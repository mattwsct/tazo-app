import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;



export async function POST(request: NextRequest) {
  try {
    // Check if admin password is configured
    if (!ADMIN_PASSWORD) {
      console.error('❌ ADMIN_PASSWORD environment variable is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const { password } = await request.json();

    if (password === ADMIN_PASSWORD) {
      const response = NextResponse.json({ success: true });
      
      // Set authentication cookie with longer duration for development
      const maxAge = process.env.NODE_ENV === 'development' 
        ? 60 * 60 * 24 * 30 // 30 days for development
        : 60 * 60 * 24 * 7; // 7 days for production
        
      response.cookies.set('auth-token', 'authenticated', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: maxAge,
      });

      return response;
    } else {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
} 