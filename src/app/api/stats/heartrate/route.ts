// === 💗 HEARTRATE STATS API ===
// Endpoint to receive heartrate updates from overlay/client
// Stores data with timestamps for rolling 24h window

import { NextRequest, NextResponse } from 'next/server';
import { storeHeartrate } from '@/utils/stats-storage';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { bpm, timestamp } = body;

    if (typeof bpm !== 'number' || bpm <= 0 || bpm > 250) {
      return NextResponse.json(
        { error: 'Invalid BPM value' },
        { status: 400 }
      );
    }

    // Use provided timestamp or current time
    const ts = timestamp && typeof timestamp === 'number' ? timestamp : Date.now();

    await storeHeartrate(bpm, ts);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to store heartrate:', error);
    return NextResponse.json(
      { error: 'Failed to store heartrate' },
      { status: 500 }
    );
  }
}
