// === 📊 STATS UPDATE API ===
// Combined endpoint to receive stats updates from overlay/client
// Accepts heartrate, speed, altitude, and location updates

import { NextRequest, NextResponse } from 'next/server';
import { storeHeartrate, storeSpeed, storeAltitude, storeLocation, addCountry, addCity } from '@/utils/stats-storage';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { heartrate, speed, altitude, location, country, city } = body;

    const promises: Promise<void>[] = [];

    // Heartrate update
    if (heartrate && typeof heartrate.bpm === 'number') {
      const ts = heartrate.timestamp || Date.now();
      promises.push(storeHeartrate(heartrate.bpm, ts));
    }

    // Speed update (can be number or object with speed and timestamp)
    if (speed !== undefined) {
      if (typeof speed === 'number' && speed >= 0) {
        promises.push(storeSpeed(speed));
      } else if (typeof speed === 'object' && speed !== null && typeof speed.speed === 'number') {
        const ts = (speed as { speed: number; timestamp?: number }).timestamp || Date.now();
        promises.push(storeSpeed((speed as { speed: number }).speed, ts));
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

    // Location update
    if (location && typeof location.lat === 'number' && typeof location.lon === 'number') {
      const ts = location.timestamp || Date.now();
      promises.push(storeLocation(location.lat, location.lon, ts));
    }

    // Country update
    if (country && typeof country === 'string') {
      promises.push(addCountry(country));
    }

    // City update
    if (city && typeof city === 'string') {
      promises.push(addCity(city));
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
