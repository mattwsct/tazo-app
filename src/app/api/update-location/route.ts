import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import { LocationService } from '@/lib/services/location'
import { WeatherService } from '@/lib/services/weather'
import type { APIResponse } from '@/types'

export async function POST(request: Request): Promise<NextResponse<APIResponse<void>>> {
  try {
    const body = await request.json()
    
    // Validate coordinates
    if (!body.latitude || !body.longitude) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing latitude or longitude',
        },
        { status: 400 }
      )
    }

    const { latitude, longitude } = body

    // Fetch location and weather data in parallel
    const [locationData, weatherData, timezone] = await Promise.all([
      LocationService.getLocationFromCoords(latitude, longitude),
      WeatherService.getWeatherFromCoords(latitude, longitude),
      LocationService.getTimezoneFromCoords(latitude, longitude),
    ])

    // Store all data in Redis
    const updatePromises = []

    if (locationData) {
      updatePromises.push(redisHelpers.updateData('location', locationData))
    }

    if (weatherData) {
      updatePromises.push(redisHelpers.updateData('weather', weatherData))
    }

    if (timezone) {
      updatePromises.push(redisHelpers.updateData('timezone', { timezone }))
    }

    await Promise.all(updatePromises)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('Error updating location and weather data:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update location and weather data',
      },
      { status: 500 }
    )
  }
} 