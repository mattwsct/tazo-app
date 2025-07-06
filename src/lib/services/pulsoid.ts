import axios from 'axios'
import type { HeartRateData } from '@/types'

const PULSOID_ACCESS_TOKEN = process.env.PULSOID_ACCESS_TOKEN
const PULSOID_BASE_URL = 'https://dev.pulsoid.net/api/v1'
const PULSOID_WEBSOCKET_URL = 'wss://dev.pulsoid.net/api/v1/data/real_time'

export class PulsoidService {
  private static ws: WebSocket | null = null
  private static onHeartRateUpdate: ((data: HeartRateData) => void) | null = null

  static async getHeartRate(): Promise<HeartRateData | null> {
    if (!PULSOID_ACCESS_TOKEN) {
      console.error('Pulsoid access token not configured')
      return null
    }

    try {
      const response = await axios.get(`${PULSOID_BASE_URL}/data/heart_rate`, {
        headers: {
          'Authorization': `Bearer ${PULSOID_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      })

      const data = response.data
      
      return {
        heartRate: data.data.heart_rate,
        timestamp: Date.now(),
      }
    } catch (error) {
      console.error('Error fetching heart rate from Pulsoid:', error)
      return null
    }
  }

  static async getHeartRateHistory(limit: number = 10): Promise<HeartRateData[]> {
    if (!PULSOID_ACCESS_TOKEN) {
      console.error('Pulsoid access token not configured')
      return []
    }

    try {
      const response = await axios.get(`${PULSOID_BASE_URL}/data/heart_rate/history`, {
        headers: {
          'Authorization': `Bearer ${PULSOID_ACCESS_TOKEN}`,
        },
        params: {
          limit,
        },
        timeout: 5000,
      })

      const data = response.data
      
      return data.data.map((item: any) => ({
        heartRate: item.heart_rate,
        timestamp: new Date(item.timestamp).getTime(),
      }))
    } catch (error) {
      console.error('Error fetching heart rate history from Pulsoid:', error)
      return []
    }
  }

  static async isConnected(): Promise<boolean> {
    try {
      const heartRate = await this.getHeartRate()
      return heartRate !== null
    } catch (error) {
      return false
    }
  }

  // WebSocket methods for real-time data
  static connectWebSocket(token: string, onUpdate?: (data: HeartRateData) => void): void {
    if (this.ws) {
      this.ws.close()
    }

    this.onHeartRateUpdate = onUpdate || null

    try {
      // Use the provided WebSocket URL with the token and legacy JSON mode
      const wsUrl = `${PULSOID_WEBSOCKET_URL}?access_token=${token}&response_mode=legacy_json`
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('Pulsoid WebSocket connected successfully')
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('Pulsoid WebSocket message:', data)
          
          // Handle the actual JSON format from Pulsoid
          if (data.data && data.data.heartRate !== undefined) {
            const heartRateData: HeartRateData = {
              heartRate: data.data.heartRate,
              timestamp: data.timestamp || Date.now(),
            }
            
            // Call the callback if provided
            if (this.onHeartRateUpdate) {
              this.onHeartRateUpdate(heartRateData)
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      this.ws.onerror = (error) => {
        console.error('Pulsoid WebSocket error:', error)
      }

      this.ws.onclose = () => {
        console.log('Pulsoid WebSocket disconnected')
        this.ws = null
      }
    } catch (error) {
      console.error('Error connecting to Pulsoid WebSocket:', error)
    }
  }

  static disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.onHeartRateUpdate = null
  }

  static isWebSocketConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
} 