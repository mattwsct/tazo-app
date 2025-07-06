'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  ClockIcon, 
  MapPinIcon, 
  CloudIcon, 
  TruckIcon,
  HeartIcon,
  Cog6ToothIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  XCircleIcon,
  SignalIcon
} from '@heroicons/react/24/outline'
import type { OverlayConfig } from '@/types'

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>({
    showTime: true,
    showLocation: true,
    showWeather: true,
    showSpeed: false,
    showHeartRate: false,
    showDebug: false,
  })
  const [apiStatus, setApiStatus] = useState({
    locationiq: false,
    openweather: false,
    pulsoid: false,
    kick: false,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [pulsoidWsToken, setPulsoidWsToken] = useState('')
  const [pulsoidWsConnected, setPulsoidWsConnected] = useState(false)

  useEffect(() => {
    // Load overlay configuration from Redis
    fetchOverlayConfig()
    // Test API connections
    testAPIs()
  }, [])

  const fetchOverlayConfig = async () => {
    try {
      const response = await fetch('/api/overlay-config')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          setOverlayConfig(data.data)
        }
      }
    } catch (error) {
      console.error('Failed to fetch overlay config:', error)
    }
  }

  const saveOverlayConfig = async (newConfig: OverlayConfig) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/overlay-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newConfig),
      })
      
      if (response.ok) {
        setOverlayConfig(newConfig)
        console.log('Overlay configuration saved successfully')
      }
    } catch (error) {
      console.error('Failed to save overlay config:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const testAPIs = async () => {
    try {
      const response = await fetch('/api/test-apis')
      if (response.ok) {
        const data = await response.json()
        setApiStatus(data.data || {})
      }
    } catch (error) {
      console.error('Failed to test APIs:', error)
    }
  }

  const handleConfigChange = (key: keyof OverlayConfig, value: boolean) => {
    const newConfig = { ...overlayConfig, [key]: value }
    setOverlayConfig(newConfig)
    saveOverlayConfig(newConfig)
  }

  const connectPulsoidWs = async () => {
    if (!pulsoidWsToken) return
    
    try {
      const response = await fetch('/api/pulsoid-ws', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'connect',
          token: pulsoidWsToken,
        }),
      })
      
      if (response.ok) {
        setPulsoidWsConnected(true)
        console.log('Pulsoid WebSocket connected')
      }
    } catch (error) {
      console.error('Failed to connect Pulsoid WebSocket:', error)
    }
  }

  const disconnectPulsoidWs = async () => {
    try {
      const response = await fetch('/api/pulsoid-ws', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'disconnect',
        }),
      })
      
      if (response.ok) {
        setPulsoidWsConnected(false)
        console.log('Pulsoid WebSocket disconnected')
      }
    } catch (error) {
      console.error('Failed to disconnect Pulsoid WebSocket:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-white">Tazo App</h1>
              <span className="ml-3 px-2 py-1 text-xs bg-green-500 text-white rounded-full">
                Live
              </span>
            </div>
            <nav className="flex space-x-8">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === 'dashboard'
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('overlay')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === 'overlay'
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Overlay
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === 'settings'
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">Dashboard</h2>
            
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center">
                  <ClockIcon className="h-8 w-8 text-blue-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-400">Local Time</p>
                    <p className="text-2xl font-semibold text-white">12:34:56</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center">
                  <MapPinIcon className="h-8 w-8 text-green-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-400">Location</p>
                    <p className="text-2xl font-semibold text-white">Loading...</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center">
                  <CloudIcon className="h-8 w-8 text-yellow-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-400">Weather</p>
                    <p className="text-2xl font-semibold text-white">--°C</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center">
                  <TruckIcon className="h-8 w-8 text-red-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-400">Speed</p>
                    <p className="text-2xl font-semibold text-white">-- km/h</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Integration Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Integrations</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <ChatBubbleLeftRightIcon className="h-5 w-5 text-purple-400 mr-3" />
                      <span className="text-white">Kick</span>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      apiStatus.kick 
                        ? 'bg-green-500 text-white' 
                        : 'bg-red-500 text-white'
                    }`}>
                      {apiStatus.kick ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <HeartIcon className="h-5 w-5 text-red-400 mr-3" />
                      <span className="text-white">Pulsoid</span>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      apiStatus.pulsoid 
                        ? 'bg-green-500 text-white' 
                        : 'bg-red-500 text-white'
                    }`}>
                      {apiStatus.pulsoid ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <MapPinIcon className="h-5 w-5 text-blue-400 mr-3" />
                      <span className="text-white">LocationIQ</span>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      apiStatus.locationiq 
                        ? 'bg-green-500 text-white' 
                        : 'bg-red-500 text-white'
                    }`}>
                      {apiStatus.locationiq ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <CloudIcon className="h-5 w-5 text-yellow-400 mr-3" />
                      <span className="text-white">OpenWeather</span>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      apiStatus.openweather 
                        ? 'bg-green-500 text-white' 
                        : 'bg-red-500 text-white'
                    }`}>
                      {apiStatus.openweather ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Link 
                    href="/overlay"
                    className="block w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Open Overlay
                  </Link>
                  <button 
                    onClick={testAPIs}
                    className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                  >
                    Test APIs
                  </button>
                  <button className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors">
                    Refresh Data
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'overlay' && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">Overlay Controls</h2>
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Overlay Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showTime}
                    onChange={(e) => handleConfigChange('showTime', e.target.checked)}
                  />
                  <span className="text-white">Show Time</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showLocation}
                    onChange={(e) => handleConfigChange('showLocation', e.target.checked)}
                  />
                  <span className="text-white">Show Location</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showWeather}
                    onChange={(e) => handleConfigChange('showWeather', e.target.checked)}
                  />
                  <span className="text-white">Show Weather</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showSpeed}
                    onChange={(e) => handleConfigChange('showSpeed', e.target.checked)}
                  />
                  <span className="text-white">Show Speed</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showHeartRate}
                    onChange={(e) => handleConfigChange('showHeartRate', e.target.checked)}
                  />
                  <span className="text-white">Show Heart Rate</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showDebug}
                    onChange={(e) => handleConfigChange('showDebug', e.target.checked)}
                  />
                  <span className="text-white">Debug Info</span>
                </label>
              </div>
              {isLoading && (
                <div className="mt-4 text-sm text-gray-400">
                  Saving configuration...
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">Settings</h2>
            
            {/* API Status */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">API Configuration Status</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center">
                    <MapPinIcon className="h-5 w-5 text-blue-400 mr-3" />
                    <span className="text-white">LocationIQ API Key</span>
                  </div>
                  <div className="flex items-center">
                    {apiStatus.locationiq ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-400 mr-2" />
                    )}
                    <span className={`text-sm ${
                      apiStatus.locationiq ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {apiStatus.locationiq ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center">
                    <CloudIcon className="h-5 w-5 text-yellow-400 mr-3" />
                    <span className="text-white">OpenWeatherMap API Key</span>
                  </div>
                  <div className="flex items-center">
                    {apiStatus.openweather ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-400 mr-2" />
                    )}
                    <span className={`text-sm ${
                      apiStatus.openweather ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {apiStatus.openweather ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center">
                    <HeartIcon className="h-5 w-5 text-red-400 mr-3" />
                    <span className="text-white">Pulsoid Access Token</span>
                  </div>
                  <div className="flex items-center">
                    {apiStatus.pulsoid ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-400 mr-2" />
                    )}
                    <span className={`text-sm ${
                      apiStatus.pulsoid ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {apiStatus.pulsoid ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center">
                    <SignalIcon className="h-5 w-5 text-purple-400 mr-3" />
                    <span className="text-white">Pulsoid WebSocket Token</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      placeholder="WebSocket token"
                      className="px-3 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm w-64"
                      value={pulsoidWsToken}
                      onChange={(e) => setPulsoidWsToken(e.target.value)}
                    />
                    <button
                      onClick={connectPulsoidWs}
                      disabled={!pulsoidWsToken || pulsoidWsConnected}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-sm rounded"
                    >
                      {pulsoidWsConnected ? 'Connected' : 'Connect'}
                    </button>
                    {pulsoidWsConnected && (
                      <button
                        onClick={disconnectPulsoidWs}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-blue-900 border border-blue-700 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-200 mb-2">How to Configure APIs</h4>
                <p className="text-sm text-blue-100 mb-3">
                  API keys should be added to your <code className="bg-blue-800 px-1 rounded">.env.local</code> file:
                </p>
                <pre className="text-xs text-blue-100 bg-blue-800 p-3 rounded overflow-x-auto">
{`LOCATIONIQ_API_KEY=your_key_here
OPENWEATHER_API_KEY=your_key_here
PULSOID_ACCESS_TOKEN=your_token_here
PULSOID_WEBSOCKET_TOKEN=your_websocket_token_here
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token`}
                </pre>
              </div>
            </div>

            {/* Overlay Configuration */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Overlay Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showTime}
                    onChange={(e) => handleConfigChange('showTime', e.target.checked)}
                  />
                  <span className="text-white">Show Time</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showLocation}
                    onChange={(e) => handleConfigChange('showLocation', e.target.checked)}
                  />
                  <span className="text-white">Show Location</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showWeather}
                    onChange={(e) => handleConfigChange('showWeather', e.target.checked)}
                  />
                  <span className="text-white">Show Weather</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showSpeed}
                    onChange={(e) => handleConfigChange('showSpeed', e.target.checked)}
                  />
                  <span className="text-white">Show Speed</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showHeartRate}
                    onChange={(e) => handleConfigChange('showHeartRate', e.target.checked)}
                  />
                  <span className="text-white">Show Heart Rate</span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    className="mr-3" 
                    checked={overlayConfig.showDebug}
                    onChange={(e) => handleConfigChange('showDebug', e.target.checked)}
                  />
                  <span className="text-white">Debug Info</span>
                </label>
              </div>
              {isLoading && (
                <div className="mt-4 text-sm text-gray-400">
                  Saving configuration...
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
} 