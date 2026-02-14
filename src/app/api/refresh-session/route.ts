import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';

export async function POST(): Promise<NextResponse> {
  try {
    // Check if user is already authenticated
    const isAuthenticated = await verifyAuth();
    
    if (!isAuthenticated) {
      return NextResponse.json({ 
        success: false, 
        error: 'Not authenticated' 
      }, { status: 401 });
    }
    
    // Refresh the authentication cookie
    const maxAge = process.env.NODE_ENV === 'development' 
      ? 60 * 60 * 24 * 30 // 30 days for development
      : 60 * 60 * 24 * 7; // 7 days for production
      
    const response = NextResponse.json({ 
      success: true, 
      message: 'Session refreshed successfully' 
    });
    
    response.cookies.set('auth-token', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: maxAge,
    });
    
    console.log('🔄 Session refresh successful');
    return response;
    
  } catch (error) {
    console.error('Session refresh error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to refresh session' 
    }, { status: 500 });
  }
}
