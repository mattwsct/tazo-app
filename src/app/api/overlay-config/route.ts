import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import type { APIResponse, OverlayConfig } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<OverlayConfig>>> {
  try {
    const config = await redisHelpers.getOverlayConfig()
    
    return NextResponse.json({
      success: true,
      data: config,
    })
  } catch (error) {
    console.error('Error fetching overlay config:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch overlay configuration',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse<APIResponse<void>>> {
  try {
    const body = await request.json()
    
    // Validate overlay config
    const requiredKeys: (keyof OverlayConfig)[] = [
      'showTime', 'showLocation', 'showWeather', 
      'showSpeed', 'showHeartRate', 'showDebug'
    ]
    
    for (const key of requiredKeys) {
      if (typeof body[key] !== 'boolean') {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid value for ${key}`,
          },
          { status: 400 }
        )
      }
    }

    const config: OverlayConfig = {
      showTime: body.showTime,
      showLocation: body.showLocation,
      showWeather: body.showWeather,
      showSpeed: body.showSpeed,
      showHeartRate: body.showHeartRate,
      showDebug: body.showDebug,
    }

    // Store in Redis
    await redisHelpers.updateData('overlayConfig', config)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('Error saving overlay config:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save overlay configuration',
      },
      { status: 500 }
    )
  }
} 