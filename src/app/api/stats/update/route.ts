// === 📊 STATS UPDATE API ===
// Combined endpoint to receive stats updates from overlay/client
// Accepts speed and altitude updates

import { NextRequest, NextResponse } from 'next/server';
import { storeSpeed, storeAltitude, storeHeartrate } from '@/utils/stats-storage';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { success } = await checkApiRateLimit(request, 'stats-update');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { speed, altitude, heartrate } = body;

    const promises: Promise<void>[] = [];

    // Speed update (can be number or object with speed and timestamp)
    if (speed !== undefined) {
      if (typeof speed === 'number' && speed >= 0) {
        promises.push(storeSpeed(speed));
      } else if (typeof speed === 'object' && speed !== null && typeof speed.speed === 'number') {
        const ts = (speed as { speed: number; timestamp?: number }).timestamp || Date.now();
        promises.push(storeSpeed((speed as { speed: number }).speed, ts));
      }
    }

    // Heartrate update (number or object with bpm and timestamp)
    if (heartrate !== undefined) {
      if (typeof heartrate === 'number' && heartrate >= 0) {
        promises.push(storeHeartrate(heartrate));
      } else if (typeof heartrate === 'object' && heartrate !== null && typeof heartrate.bpm === 'number') {
        const ts = (heartrate as { bpm: number; timestamp?: number }).timestamp || Date.now();
        promises.push(storeHeartrate((heartrate as { bpm: number }).bpm, ts));
      }
    }

    // Altitude update (can be number or object with altitude and timestamp)
    if (altitude !== undefined) {
      if (typeof altitude === 'number') {
        promises.push(storeAltitude(altitude));
      } else if (typeof altitude === 'object' && altitude !== null && typeof altitude.altitude === 'number') {
        const ts = (altitude as { altitude: number; timestamp?: number }).timestamp || Date.now();
        promises.push(storeAltitude((altitude as { altitude: number }).altitude, ts));
      }
    }

    await Promise.all(promises);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update stats:', error);
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
