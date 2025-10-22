# Environment Setup Instructions

## Create .env.local file

Create a `.env.local` file in the root directory with the following content:

```env
# Tazo Streaming Overlay - Local Environment Variables

# === REQUIRED API KEYS ===

# RealtimeIRL - For live GPS tracking during IRL streams
# Get your pull key from: https://realtimeirl.com/
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key_here

# LocationIQ - For reverse geocoding (GPS coordinates to location names)
# Get your API key from: https://locationiq.com/
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_api_key_here

# OpenWeatherMap - For weather data and sunrise/sunset times
# Get your API key from: https://openweathermap.org/api
NEXT_PUBLIC_OPENWEATHERMAP_KEY=92b29dc07db75f14d5900cc500ac9407

# === OPTIONAL API KEYS ===

# Pulsoid - For heart rate monitoring during streams
# Get your token from: https://pulsoid.net/
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_token_here

# Mapbox - For map tiles (fallback if LocationIQ fails)
# Get your access token from: https://mapbox.com/
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here

# === OPTIONAL FEATURES ===

# OBS Password - For OBS WebSocket integration (optional)
OBS_PASSWORD=your_obs_password_here

# Vercel KV - For real-time settings sync (optional)
# KV_URL=your_vercel_kv_url_here
# KV_REST_API_URL=your_vercel_kv_rest_api_url_here
# KV_REST_API_TOKEN=your_vercel_kv_rest_api_token_here
```

## What's Changed

✅ **Switched to OpenWeatherMap API** - More reliable and includes sunrise/sunset data
✅ **Combined API calls** - Weather + sunrise/sunset in one request (more efficient)
✅ **Better rate limits** - OpenWeatherMap has more generous limits
✅ **Accurate day/night detection** - Uses real astronomical data for your location

## Next Steps

1. Create the `.env.local` file with your API keys
2. Restart your development server (`npm run dev`)
3. Test the overlay page - you should see accurate sunrise/sunset times in the console logs

The weather icon will now show the correct sun/moon based on real sunrise/sunset times for your exact GPS location! 🌞🌙
