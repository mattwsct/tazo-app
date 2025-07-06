'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import Image from 'next/image'
import type { OverlayData, OverlayConfig } from '@/types'

export default function OverlayPage() {
  const [data, setData] = useState<OverlayData>({
    time: '--:--:--',
    location: 'Loading...',
    weather: {
      temp: 0,
      condition: 'Unknown',
      icon: '',
      humidity: 0,
      windSpeed: 0,
    },
    speed: 0,
    heartRate: 0,
    timezone: 'UTC',
    lastUpdate: Date.now()
  })

  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>({
    showTime: true,
    showLocation: true,
    showWeather: true,
    showSpeed: false,
    showHeartRate: false,
    showDebug: false,
  })

  useEffect(() => {
    // Load overlay configuration
    fetchOverlayConfig()
    
    // Update time every second
    const timeInterval = setInterval(() => {
      const now = new Date()
      setData(prev => ({
        ...prev,
        time: formatInTimeZone(now, prev.timezone, 'HH:mm:ss')
      }))
    }, 1000)

    // Poll for data updates every 30 seconds
    const dataInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/overlay-data')
        if (response.ok) {
          const newData = await response.json()
          setData(prev => ({ ...prev, ...newData }))
        }
      } catch (error) {
        console.error('Failed to fetch overlay data:', error)
      }
    }, 30000)

    return () => {
      clearInterval(timeInterval)
      clearInterval(dataInterval)
    }
  }, [])

  const fetchOverlayConfig = async () => {
    try {
      const response = await fetch('/api/overlay-config')
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          setOverlayConfig(result.data)
        }
      }
    } catch (error) {
      console.error('Failed to fetch overlay config:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-transparent pointer-events-none">
      {/* Top Left Corner - Time and Location */}
      {overlayConfig.showTime && (
        <div className="absolute top-4 left-4 space-y-2">
          <div className="overlay-bg rounded-lg px-4 py-2">
            <div className="text-4xl font-mono font-bold text-white overlay-text">
              {data.time}
            </div>
          </div>
          
          {overlayConfig.showLocation && (
            <div className="overlay-bg rounded-lg px-4 py-2">
              <div className="text-xl font-semibold text-white overlay-text">
                {data.location}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Right Corner - Weather */}
      {overlayConfig.showWeather && (
        <div className="absolute top-4 right-4">
          <div className="overlay-bg rounded-lg px-4 py-2">
            <div className="flex items-center space-x-2">
              {data.weather.icon && (
                <Image 
                  src={data.weather.icon} 
                  alt={data.weather.condition}
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              )}
              <div className="text-2xl font-bold text-white overlay-text">
                {data.weather.temp}°C
              </div>
            </div>
            <div className="text-sm text-white overlay-text opacity-80">
              {data.weather.condition}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Left Corner - Speed (if enabled) */}
      {overlayConfig.showSpeed && (
        <div className="absolute bottom-4 left-4">
          <div className="overlay-bg rounded-lg px-4 py-2">
            <div className="text-2xl font-bold text-white overlay-text">
              {data.speed} km/h
            </div>
            <div className="text-sm text-white overlay-text opacity-80">
              Speed
            </div>
          </div>
        </div>
      )}

      {/* Bottom Right Corner - Heart Rate (if enabled) */}
      {overlayConfig.showHeartRate && (
        <div className="absolute bottom-4 right-4">
          <div className="overlay-bg rounded-lg px-4 py-2">
            <div className="text-2xl font-bold text-red-400 overlay-text">
              {data.heartRate} BPM
            </div>
            <div className="text-sm text-white overlay-text opacity-80">
              Heart Rate
            </div>
          </div>
        </div>
      )}

      {/* Debug Info (if enabled) */}
      {overlayConfig.showDebug && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="overlay-bg rounded-lg px-4 py-2">
            <div className="text-sm font-mono text-white overlay-text">
              <div>Timezone: {data.timezone}</div>
              <div>Last Update: {new Date().toLocaleTimeString()}</div>
              <div>Speed Enabled: {overlayConfig.showSpeed ? 'Yes' : 'No'}</div>
              <div>Heart Rate Enabled: {overlayConfig.showHeartRate ? 'Yes' : 'No'}</div>
              <div>Weather Enabled: {overlayConfig.showWeather ? 'Yes' : 'No'}</div>
              <div>Location Enabled: {overlayConfig.showLocation ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Controls (only visible in development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <div className="overlay-bg rounded-lg px-4 py-2 pointer-events-auto">
            <div className="flex space-x-4 text-sm">
              <label className="flex items-center text-white">
                <input 
                  type="checkbox" 
                  checked={overlayConfig.showSpeed}
                  onChange={(e) => {
                    const newConfig = { ...overlayConfig, showSpeed: e.target.checked }
                    setOverlayConfig(newConfig)
                    fetch('/api/overlay-config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(newConfig),
                    })
                  }}
                  className="mr-2"
                />
                Speed
              </label>
              <label className="flex items-center text-white">
                <input 
                  type="checkbox" 
                  checked={overlayConfig.showHeartRate}
                  onChange={(e) => {
                    const newConfig = { ...overlayConfig, showHeartRate: e.target.checked }
                    setOverlayConfig(newConfig)
                    fetch('/api/overlay-config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(newConfig),
                    })
                  }}
                  className="mr-2"
                />
                Heart Rate
              </label>
              <label className="flex items-center text-white">
                <input 
                  type="checkbox" 
                  checked={overlayConfig.showDebug}
                  onChange={(e) => {
                    const newConfig = { ...overlayConfig, showDebug: e.target.checked }
                    setOverlayConfig(newConfig)
                    fetch('/api/overlay-config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(newConfig),
                    })
                  }}
                  className="mr-2"
                />
                Debug
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 