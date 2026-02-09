import { NextResponse } from 'next/server';
import { getPersistentLocation } from '@/utils/location-cache';
import { formatLocation } from '@/utils/location-utils';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import { kv } from '@vercel/kv';
import type { OverlaySettings } from '@/types/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get persistent location (always available, even if stale)
    const persistentLocation = await getPersistentLocation();
    
    if (!persistentLocation || !persistentLocation.location) {
      return NextResponse.json({ location: null });
    }
    
    // Get settings to format location correctly
    const settings = (await kv.get<OverlaySettings>('overlay_settings')) || DEFAULT_OVERLAY_SETTINGS;
    const displayMode = settings.locationDisplay;
    
    // Format location using current display mode
    const formatted = formatLocation(persistentLocation.location, displayMode);
    
    return NextResponse.json({
      location: {
        primary: formatted.primary || '',
        secondary: formatted.secondary,
        countryCode: persistentLocation.location.countryCode || '',
      },
      rawLocation: persistentLocation.location,
    });
  } catch (error) {
    console.error('Failed to get persistent location:', error);
    return NextResponse.json({ location: null }, { status: 500 });
  }
}
