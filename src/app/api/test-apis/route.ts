import { NextResponse } from 'next/server'
import { LocationService } from '@/lib/services/location'
import { WeatherService } from '@/lib/services/weather'
import { PulsoidService } from '@/lib/services/pulsoid'
import type { APIResponse } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<Record<string, boolean>>>> {
  try {
    const results = {
      locationiq: false,
      openweather: false,
      pulsoid: false,
      kick: false, // Will be implemented later
    }

    // Test LocationIQ API
    try {
      if (process.env.LOCATIONIQ_API_KEY) {
        // Test with a known location (New York City)
        const location = await LocationService.getLocationFromCoords(40.7128, -74.0060)
        results.locationiq = location !== null
      }
    } catch (error) {
      console.error('LocationIQ API test failed:', error)
    }

    // Test OpenWeatherMap API
    try {
      if (process.env.OPENWEATHER_API_KEY) {
        // Test with a known location (New York City)
        const weather = await WeatherService.getWeatherFromCoords(40.7128, -74.0060)
        results.openweather = weather !== null
      }
    } catch (error) {
      console.error('OpenWeatherMap API test failed:', error)
    }

    // Test Pulsoid API
    try {
      if (process.env.PULSOID_ACCESS_TOKEN) {
        const isConnected = await PulsoidService.isConnected()
        results.pulsoid = isConnected
      }
    } catch (error) {
      console.error('Pulsoid API test failed:', error)
    }

    // Kick integration will be implemented later
    results.kick = false

    return NextResponse.json({
      success: true,
      data: results,
    })
  } catch (error) {
    console.error('Error testing APIs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to test APIs',
      },
      { status: 500 }
    )
  }
} 