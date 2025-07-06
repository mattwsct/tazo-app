import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import { PulsoidService } from '@/lib/services/pulsoid'
import type { APIResponse } from '@/types'

export async function GET(request: Request): Promise<NextResponse<APIResponse<{ status: string }>>> {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing Pulsoid token',
        },
        { status: 400 }
      )
    }

    // Connect to Pulsoid WebSocket
    PulsoidService.connectWebSocket(token, async (heartRateData) => {
      // Store the heart rate data in Redis
      await redisHelpers.updateData('heartRate', heartRateData)
      console.log('Heart rate updated via WebSocket:', heartRateData.heartRate)
    })

    return NextResponse.json({
      success: true,
      data: { status: 'WebSocket connection initiated' },
    })
  } catch (error) {
    console.error('Error setting up Pulsoid WebSocket:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to setup WebSocket connection',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse<APIResponse<{ status: string }>>> {
  try {
    const body = await request.json()
    const { action, token } = body

    if (action === 'connect' && token) {
      // Connect to Pulsoid WebSocket
      PulsoidService.connectWebSocket(token, async (heartRateData) => {
        // Store the heart rate data in Redis
        await redisHelpers.updateData('heartRate', heartRateData)
        console.log('Heart rate updated via WebSocket:', heartRateData.heartRate)
      })

      return NextResponse.json({
        success: true,
        data: { status: 'WebSocket connected' },
      })
    } else if (action === 'disconnect') {
      // Disconnect from Pulsoid WebSocket
      PulsoidService.disconnectWebSocket()

      return NextResponse.json({
        success: true,
        data: { status: 'WebSocket disconnected' },
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action or missing token',
        },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error handling Pulsoid WebSocket action:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to handle WebSocket action',
      },
      { status: 500 }
    )
  }
} 