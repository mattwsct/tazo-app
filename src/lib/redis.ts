import { Redis } from '@upstash/redis'
import type { RedisData } from '@/types'

// Check if Redis environment variables are available
const hasRedisConfig = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN

// Create Redis client only if environment variables are available
export const redis = hasRedisConfig 
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null

// In-memory fallback storage when Redis is not available
const memoryStorage: Record<string, any> = {}

// Helper functions for Redis operations
export const redisHelpers = {
  // Get all overlay data
  async getOverlayData(): Promise<Partial<RedisData>> {
    try {
      if (redis) {
        const data = await redis.get('overlay-data')
        return data as Partial<RedisData> || {}
      } else {
        return memoryStorage['overlay-data'] || {}
      }
    } catch (error) {
      console.error('Failed to get overlay data:', error)
      return memoryStorage['overlay-data'] || {}
    }
  },

  // Update specific data
  async updateData(key: keyof RedisData, value: any): Promise<void> {
    try {
      if (redis) {
        await redis.hset('overlay-data', { [key]: value })
      } else {
        if (!memoryStorage['overlay-data']) {
          memoryStorage['overlay-data'] = {}
        }
        memoryStorage['overlay-data'][key] = value
      }
    } catch (error) {
      console.error(`Failed to update ${key}:`, error)
      // Fallback to memory storage
      if (!memoryStorage['overlay-data']) {
        memoryStorage['overlay-data'] = {}
      }
      memoryStorage['overlay-data'][key] = value
    }
  },

  // Get GPS data
  async getGPSData() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'gps')
        return data as any || null
      } else {
        return memoryStorage['overlay-data']?.gps || null
      }
    } catch (error) {
      console.error('Failed to get GPS data:', error)
      return memoryStorage['overlay-data']?.gps || null
    }
  },

  // Get weather data
  async getWeatherData() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'weather')
        return data as any || null
      } else {
        return memoryStorage['overlay-data']?.weather || null
      }
    } catch (error) {
      console.error('Failed to get weather data:', error)
      return memoryStorage['overlay-data']?.weather || null
    }
  },

  // Get location data
  async getLocationData() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'location')
        return data as any || null
      } else {
        return memoryStorage['overlay-data']?.location || null
      }
    } catch (error) {
      console.error('Failed to get location data:', error)
      return memoryStorage['overlay-data']?.location || null
    }
  },

  // Get timezone data
  async getTimezoneData() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'timezone')
        return data as any || null
      } else {
        return memoryStorage['overlay-data']?.timezone || null
      }
    } catch (error) {
      console.error('Failed to get timezone data:', error)
      return memoryStorage['overlay-data']?.timezone || null
    }
  },

  // Get heart rate data
  async getHeartRateData() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'heartRate')
        return data as any || null
      } else {
        return memoryStorage['overlay-data']?.heartRate || null
      }
    } catch (error) {
      console.error('Failed to get heart rate data:', error)
      return memoryStorage['overlay-data']?.heartRate || null
    }
  },

  // Get overlay configuration
  async getOverlayConfig() {
    try {
      if (redis) {
        const data = await redis.hget('overlay-data', 'overlayConfig')
        return data as any || {
          showTime: true,
          showLocation: true,
          showWeather: true,
          showSpeed: false,
          showHeartRate: false,
          showDebug: false,
        }
      } else {
        return memoryStorage['overlay-data']?.overlayConfig || {
          showTime: true,
          showLocation: true,
          showWeather: true,
          showSpeed: false,
          showHeartRate: false,
          showDebug: false,
        }
      }
    } catch (error) {
      console.error('Failed to get overlay config:', error)
      return {
        showTime: true,
        showLocation: true,
        showWeather: true,
        showSpeed: false,
        showHeartRate: false,
        showDebug: false,
      }
    }
  },

  // Add Kick event
  async addKickEvent(event: any): Promise<void> {
    try {
      if (redis) {
        const events = await redis.lrange('kick-events', 0, 99) // Keep last 100 events
        events.unshift(event)
        await redis.del('kick-events')
        if (events.length > 0) {
          await redis.lpush('kick-events', ...events.slice(0, 100))
        }
      } else {
        if (!memoryStorage['kick-events']) {
          memoryStorage['kick-events'] = []
        }
        memoryStorage['kick-events'].unshift(event)
        memoryStorage['kick-events'] = memoryStorage['kick-events'].slice(0, 100)
      }
    } catch (error) {
      console.error('Failed to add Kick event:', error)
    }
  },

  // Get Kick events
  async getKickEvents(): Promise<any[]> {
    try {
      if (redis) {
        const events = await redis.lrange('kick-events', 0, 99)
        return events || []
      } else {
        return memoryStorage['kick-events'] || []
      }
    } catch (error) {
      console.error('Failed to get Kick events:', error)
      return memoryStorage['kick-events'] || []
    }
  },
} 