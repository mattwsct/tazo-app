import axios from 'axios'
import type { LocationData } from '@/types'

const LOCATIONIQ_API_KEY = process.env.LOCATIONIQ_API_KEY
const LOCATIONIQ_BASE_URL = 'https://us1.locationiq.com/v1'

export class LocationService {
  static async getLocationFromCoords(latitude: number, longitude: number): Promise<LocationData | null> {
    if (!LOCATIONIQ_API_KEY) {
      console.error('LocationIQ API key not configured')
      return null
    }

    try {
      const response = await axios.get(`${LOCATIONIQ_BASE_URL}/reverse.php`, {
        params: {
          key: LOCATIONIQ_API_KEY,
          lat: latitude,
          lon: longitude,
          format: 'json',
          addressdetails: 1,
        },
        timeout: 5000,
      })

      const data = response.data
      const address = data.address

      // Format location according to user preference (City, Country or State, Country)
      let city = address.city || address.town || address.village || ''
      let state = address.state || address.province || ''
      let country = address.country || ''

      // If no city, use state
      if (!city && state) {
        city = state
        state = ''
      }

      return {
        city,
        state: state || undefined,
        country,
        formatted: city ? `${city}, ${country}` : state ? `${state}, ${country}` : country,
      }
    } catch (error) {
      console.error('Error fetching location from LocationIQ:', error)
      return null
    }
  }

  static async getTimezoneFromCoords(latitude: number, longitude: number): Promise<string | null> {
    if (!LOCATIONIQ_API_KEY) {
      console.error('LocationIQ API key not configured')
      return null
    }

    try {
      const response = await axios.get(`${LOCATIONIQ_BASE_URL}/timezone.php`, {
        params: {
          key: LOCATIONIQ_API_KEY,
          lat: latitude,
          lon: longitude,
          format: 'json',
        },
        timeout: 5000,
      })

      return response.data.timezone || 'UTC'
    } catch (error) {
      console.error('Error fetching timezone from LocationIQ:', error)
      return 'UTC'
    }
  }
} 