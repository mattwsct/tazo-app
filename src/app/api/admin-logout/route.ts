import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    
    // Clear the authentication cookie
    cookieStore.delete('admin-auth');
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Logout failed' },
      { status: 500 }
    );
  }
} 