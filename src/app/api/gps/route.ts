import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import type { APIResponse, GPSData } from '@/types'

export async function POST(request: Request): Promise<NextResponse<APIResponse<void>>> {
  try {
    const body = await request.json()
    
    // Validate GPS data
    if (!body.latitude || !body.longitude) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing latitude or longitude',
        },
        { status: 400 }
      )
    }

    const gpsData: GPSData = {
      latitude: parseFloat(body.latitude),
      longitude: parseFloat(body.longitude),
      speed: parseFloat(body.speed || '0'),
      timestamp: Date.now(),
    }

    // Store in Redis
    await redisHelpers.updateData('gps', gpsData)

    // Trigger location and weather updates if coordinates changed significantly
    const lastGPS = await redisHelpers.getGPSData()
    if (!lastGPS || 
        Math.abs(lastGPS.latitude - gpsData.latitude) > 0.01 || 
        Math.abs(lastGPS.longitude - gpsData.longitude) > 0.01) {
      
      // This would trigger background jobs to update location and weather
      // For now, we'll just log it
      console.log('GPS coordinates changed significantly, should update location and weather')
    }

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('Error processing GPS data:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process GPS data',
      },
      { status: 500 }
    )
  }
}

export async function GET(): Promise<NextResponse<APIResponse<GPSData>>> {
  try {
    const gpsData = await redisHelpers.getGPSData()
    
    return NextResponse.json({
      success: true,
      data: gpsData,
    })
  } catch (error) {
    console.error('Error fetching GPS data:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch GPS data',
      },
      { status: 500 }
    )
  }
} 