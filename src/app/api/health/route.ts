import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import { PulsoidService } from '@/lib/services/pulsoid'
import type { APIResponse } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<{
  status: string
  timestamp: string
  redis: boolean
  pulsoid: boolean
  locationiq: boolean
  openweather: boolean
  environment: string
}>>> {
  try {
    const timestamp = new Date().toISOString()
    const environment = process.env.NODE_ENV || 'development'
    
    // Test Redis connection
    let redisStatus = false
    try {
      await redisHelpers.getOverlayData()
      redisStatus = true
    } catch (error) {
      console.error('Redis health check failed:', error)
    }
    
    // Test Pulsoid connection
    let pulsoidStatus = false
    try {
      pulsoidStatus = await PulsoidService.isConnected()
    } catch (error) {
      console.error('Pulsoid health check failed:', error)
    }
    
    // For now, we'll assume these are configured if Redis is working
    const locationiqStatus = redisStatus
    const openweatherStatus = redisStatus
    
    const overallStatus = redisStatus ? 'healthy' : 'degraded'
    
    return NextResponse.json({
      success: true,
      data: {
        status: overallStatus,
        timestamp,
        redis: redisStatus,
        pulsoid: pulsoidStatus,
        locationiq: locationiqStatus,
        openweather: openweatherStatus,
        environment,
      },
    })
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Health check failed',
        data: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          redis: false,
          pulsoid: false,
          locationiq: false,
          openweather: false,
          environment: process.env.NODE_ENV || 'development',
        },
      },
      { status: 500 }
    )
  }
} 