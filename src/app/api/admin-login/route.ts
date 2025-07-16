import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminLogin, checkRateLimit, getClientIP } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request);
    
    // Rate limiting: 5 login attempts per minute per IP
    if (!checkRateLimit(`login:${clientIP}`, 5, 60000)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.' }, 
        { status: 429 }
      );
    }
    
    const { password } = await request.json();
    
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }
    
    const token = await verifyAdminLogin(password);
    
    if (token) {
      return NextResponse.json({ 
        success: true, 
        token,
        expiresIn: '24h'
      });
    } else {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
} 