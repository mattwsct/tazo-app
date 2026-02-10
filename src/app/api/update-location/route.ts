import { NextResponse } from 'next/server';
import { updatePersistentLocation } from '@/utils/location-cache';
import type { PersistentLocationData } from '@/utils/location-cache';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
    }

    const body: PersistentLocationData = await request.json();
    const { location, rtirl, updatedAt } = body;

    if (!location || !rtirl || typeof updatedAt !== 'number') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    await updatePersistentLocation({ location, rtirl, updatedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn('Failed to update persistent location:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
