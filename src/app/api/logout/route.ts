import { NextResponse } from 'next/server';

export async function GET() {
  const response = NextResponse.json({ success: true });
  
  // Clear the authentication cookie
  response.cookies.set('auth-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0, // Expire immediately
  });

  return response;
} 