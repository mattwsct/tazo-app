// GPS and Location types
export interface GPSData {
  latitude: number
  longitude: number
  speed: number
  timestamp: number
}

export interface LocationData {
  city: string
  state?: string
  country: string
  formatted: string
}

// Weather types
export interface WeatherData {
  temp: number
  condition: string
  icon: string
  humidity: number
  windSpeed: number
}

// Timezone types
export interface TimezoneData {
  timezone: string
  localTime: string
  offset: number
}

// Kick integration types
export interface KickEvent {
  type: 'sub' | 'follow' | 'gift' | 'chat'
  username: string
  message?: string
  amount?: number
  timestamp: number
}

// Pulsoid types
export interface HeartRateData {
  heartRate: number
  timestamp: number
}

// Overlay configuration
export interface OverlayConfig {
  showTime: boolean
  showLocation: boolean
  showWeather: boolean
  showSpeed: boolean
  showHeartRate: boolean
  showDebug: boolean
}

// Combined overlay data
export interface OverlayData {
  time: string
  location: string
  weather: WeatherData
  speed: number
  heartRate: number
  timezone: string
  lastUpdate: number
}

// API response types
export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// Redis data structure
export interface RedisData {
  gps: GPSData
  location: LocationData
  weather: WeatherData
  timezone: TimezoneData
  heartRate: HeartRateData
  kickEvents: KickEvent[]
  overlayConfig: OverlayConfig
} 