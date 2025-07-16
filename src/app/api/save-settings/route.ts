import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const settings = await request.json();
    await kv.set('overlay_settings', settings);
    console.log('Saved overlay settings:', settings);
    
    // Broadcast to SSE clients
    try {
      const { broadcastSettings } = await import('@/lib/settings-broadcast');
      await broadcastSettings(settings);
    } catch (error) {
      console.warn('Could not broadcast settings:', error);
    }
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
} 