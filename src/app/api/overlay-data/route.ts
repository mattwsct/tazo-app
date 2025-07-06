import { NextResponse } from 'next/server'
import { redisHelpers } from '@/lib/redis'
import { formatInTimeZone } from 'date-fns-tz'
import type { APIResponse, OverlayData } from '@/types'

export async function GET(): Promise<NextResponse<APIResponse<OverlayData>>> {
  try {
    // Get all data from Redis
    const [gpsData, locationData, weatherData, timezoneData, heartRateData] = await Promise.all([
      redisHelpers.getGPSData(),
      redisHelpers.getLocationData(),
      redisHelpers.getWeatherData(),
      redisHelpers.getTimezoneData(),
      redisHelpers.getHeartRateData(),
    ])

    // Format location string according to user preference (City, Country or State, Country)
    let locationString = 'Demo Location'
    if (locationData) {
      if (locationData.city) {
        locationString = `${locationData.city}, ${locationData.country}`
      } else if (locationData.state) {
        locationString = `${locationData.state}, ${locationData.country}`
      } else {
        locationString = locationData.country
      }
    }

    // Get current time in the correct timezone
    const timezone = timezoneData?.timezone || 'UTC'
    const currentTime = formatInTimeZone(new Date(), timezone, 'HH:mm:ss')

    // Use mock data if no real data is available
    const overlayData: OverlayData = {
      time: currentTime,
      location: locationString,
      weather: weatherData || {
        temp: 22,
        condition: 'Partly Cloudy',
        icon: 'https://openweathermap.org/img/wn/02d@2x.png',
        humidity: 65,
        windSpeed: 12,
      },
      speed: gpsData?.speed || 45,
      heartRate: heartRateData?.heartRate || 72,
      timezone: timezone,
      lastUpdate: Date.now(),
    }

    return NextResponse.json({
      success: true,
      data: overlayData,
    })
  } catch (error) {
    console.error('Error fetching overlay data:', error)
    
    // Return mock data as fallback
    const mockData: OverlayData = {
      time: formatInTimeZone(new Date(), 'UTC', 'HH:mm:ss'),
      location: 'Demo Location',
      weather: {
        temp: 22,
        condition: 'Partly Cloudy',
        icon: 'https://openweathermap.org/img/wn/02d@2x.png',
        humidity: 65,
        windSpeed: 12,
      },
      speed: 45,
      heartRate: 72,
      timezone: 'UTC',
      lastUpdate: Date.now(),
    }

    return NextResponse.json({
      success: true,
      data: mockData,
    })
  }
} 