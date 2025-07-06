import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'
import type { APIResponse } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<{ status: string; data?: any }>>> {
  try {
    // Use Redis.fromEnv() as recommended by Vercel
    const redis = Redis.fromEnv()
    
    // Test Redis connection
    const testKey = 'test-connection'
    const testValue = { timestamp: Date.now(), message: 'Hello from Vercel!' }
    
    // Set a test value
    await redis.set(testKey, testValue)
    
    // Get the test value
    const result = await redis.get(testKey)
    
    // Clean up
    await redis.del(testKey)
    
    return NextResponse.json({
      success: true,
      data: {
        status: 'Redis connection successful',
        data: result
      }
    })
  } catch (error) {
    console.error('Redis test failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Redis connection failed',
        data: {
          status: 'Redis connection failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse<APIResponse<{ status: string }>>> {
  try {
    const body = await request.json()
    const { key, value } = body
    
    if (!key || value === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing key or value'
        },
        { status: 400 }
      )
    }
    
    const redis = Redis.fromEnv()
    await redis.set(key, value)
    
    return NextResponse.json({
      success: true,
      data: {
        status: `Successfully set ${key}`
      }
    })
  } catch (error) {
    console.error('Redis POST failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to set Redis value'
      },
      { status: 500 }
    )
  }
} 