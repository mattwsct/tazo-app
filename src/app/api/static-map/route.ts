import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/utils/overlay-utils';

// Simple in-memory cache for map images
const mapCache = new Map<string, { data: ArrayBuffer; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const zoom = searchParams.get('zoom') || '13';
  const size = searchParams.get('size') || '200';
  
  if (!lat || !lon) {
    return NextResponse.json({ error: 'Missing lat/lon parameters' }, { status: 400 });
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) {
    return NextResponse.json({ error: 'Mapbox token not configured' }, { status: 500 });
  }

  // Check rate limits
  if (!checkRateLimit('mapbox')) {
    console.warn('Mapbox API rate limit exceeded, returning cached image or error');
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Create cache key (round coordinates to reduce cache misses)
  const cacheKey = `map_${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}_${zoom}_${size}`;
  
  // Check cache first
  const cached = mapCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log('Using cached map image for:', cacheKey);
    return new NextResponse(cached.data, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    // Create the Mapbox static API URL
    const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${lon},${lat},${zoom}/${size}x${size}@2x?access_token=${mapboxToken}`;
    
    // Fetch the image from Mapbox
    const response = await fetch(mapboxUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Mapbox API error:', response.status, errorText);
      return NextResponse.json({ 
        error: 'Failed to fetch map', 
        details: errorText 
      }, { status: response.status });
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    
    // Cache the result
    mapCache.set(cacheKey, { data: imageBuffer, timestamp: Date.now() });
    
    // Clean up old cache entries (keep only last 100)
    if (mapCache.size > 100) {
      const entries = Array.from(mapCache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      entries.slice(100).forEach(([key]) => mapCache.delete(key));
    }
    
    // Return the image with proper headers
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        'X-Cache': 'MISS',
      },
    });
    
  } catch (error) {
    console.error('Static map proxy error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 