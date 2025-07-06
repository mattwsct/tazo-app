import axios from 'axios'
import type { WeatherData } from '@/types'

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5'

export class WeatherService {
  static async getWeatherFromCoords(latitude: number, longitude: number): Promise<WeatherData | null> {
    if (!OPENWEATHER_API_KEY) {
      console.error('OpenWeatherMap API key not configured')
      return null
    }

    try {
      const response = await axios.get(`${OPENWEATHER_BASE_URL}/weather`, {
        params: {
          lat: latitude,
          lon: longitude,
          appid: OPENWEATHER_API_KEY,
          units: 'metric', // Use Celsius
          lang: 'en',
        },
        timeout: 5000,
      })

      const data = response.data
      const weather = data.weather[0]

      return {
        temp: Math.round(data.main.temp),
        condition: weather.main,
        icon: `https://openweathermap.org/img/wn/${weather.icon}@2x.png`,
        humidity: data.main.humidity,
        windSpeed: Math.round(data.wind.speed * 3.6), // Convert m/s to km/h
      }
    } catch (error) {
      console.error('Error fetching weather from OpenWeatherMap:', error)
      return null
    }
  }

  static async getWeatherFromCity(city: string): Promise<WeatherData | null> {
    if (!OPENWEATHER_API_KEY) {
      console.error('OpenWeatherMap API key not configured')
      return null
    }

    try {
      const response = await axios.get(`${OPENWEATHER_BASE_URL}/weather`, {
        params: {
          q: city,
          appid: OPENWEATHER_API_KEY,
          units: 'metric',
          lang: 'en',
        },
        timeout: 5000,
      })

      const data = response.data
      const weather = data.weather[0]

      return {
        temp: Math.round(data.main.temp),
        condition: weather.main,
        icon: `https://openweathermap.org/img/wn/${weather.icon}@2x.png`,
        humidity: data.main.humidity,
        windSpeed: Math.round(data.wind.speed * 3.6),
      }
    } catch (error) {
      console.error('Error fetching weather from OpenWeatherMap:', error)
      return null
    }
  }
} 