import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import { PulsoidService } from '@/lib/services/pulsoid'
import type { APIResponse, HeartRateData } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<HeartRateData | null>>> {
  try {
    const heartRateData = await PulsoidService.getHeartRate()
    
    if (heartRateData) {
      // Store in Redis
      await redisHelpers.updateData('heartRate', heartRateData)
    }

    return NextResponse.json({
      success: true,
      data: heartRateData,
    })
  } catch (error) {
    console.error('Error fetching heart rate data:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch heart rate data',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse<APIResponse<void>>> {
  try {
    const body = await request.json()
    
    // Validate heart rate data
    if (!body.heartRate || typeof body.heartRate !== 'number') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid heart rate data',
        },
        { status: 400 }
      )
    }

    const heartRateData: HeartRateData = {
      heartRate: body.heartRate,
      timestamp: Date.now(),
    }

    // Store in Redis
    await redisHelpers.updateData('heartRate', heartRateData)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('Error processing heart rate data:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process heart rate data',
      },
      { status: 500 }
    )
  }
} 