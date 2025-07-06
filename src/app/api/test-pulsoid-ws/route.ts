import { NextResponse } from 'next/server'
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

    // Test WebSocket connection
    let connectionStatus = 'disconnected'
    let receivedData = null

    PulsoidService.connectWebSocket(token, (heartRateData) => {
      receivedData = heartRateData
      console.log('Test: Received heart rate data:', heartRateData)
    })

    // Wait a bit to see if we get any data
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Check if we received any data
    if (receivedData) {
      connectionStatus = 'connected_with_data'
    } else if (PulsoidService.isWebSocketConnected()) {
      connectionStatus = 'connected_no_data'
    } else {
      connectionStatus = 'failed_to_connect'
    }

    // Clean up
    PulsoidService.disconnectWebSocket()

    return NextResponse.json({
      success: true,
      data: { 
        status: connectionStatus,
        receivedData
      },
    })
  } catch (error) {
    console.error('Error testing Pulsoid WebSocket:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to test WebSocket connection',
      },
      { status: 500 }
    )
  }
} 