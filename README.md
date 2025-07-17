# Tazo Streaming Overlay

A real-time streaming overlay for OBS with admin panel, built with Next.js 15. Displays location, weather, speed, and time data from RealtimeIRL and Open-Meteo APIs.

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# RealtimeIRL API Key (required)
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key_here

# LocationIQ API Key (required for location names)
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_api_key_here

# Pulsoid API Token (optional - for heart rate display)
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_access_token_here

# Vercel KV Database (required for settings storage)
KV_REST_API_URL=your_vercel_kv_rest_api_url
KV_REST_API_TOKEN=your_vercel_kv_rest_api_token

# Admin Panel Password (defaults to 'admin123' if not set)
ADMIN_PASSWORD=your_secure_admin_password_here

# API Protection (required for security)
API_SECRET=your_secure_random_api_secret_here
NEXT_PUBLIC_API_SECRET=your_secure_random_api_secret_here
```

## Getting Started

```bash
npm install
npm run dev
```

## Usage

- **Admin Panel**: [http://localhost:3000](http://localhost:3000) - Configure overlay settings (password protected)
- **Overlay**: [http://localhost:3000/overlay](http://localhost:3000/overlay) - Add as browser source in OBS

## Features

- 🌍 **Location Display**: City-level location with country flags
- 🌤️ **Weather**: Real-time temperature and conditions 
- 🚗 **Speed**: Vehicle speed display (shows when moving > 10 km/h)
- ⏰ **Time**: Local time based on current timezone
- ❤️ **Heart Rate**: Auto-displaying BPM with realistic heartbeat animation (via Pulsoid)
- 🗺️ **GPS Minimap**: Circular minimap showing current location (auto-updating)
- ⚙️ **Admin Panel**: Real-time settings control with auto-save
- 📡 **Real-time Updates**: Server-sent events for instant setting changes
- 🎨 **Unified Design**: Consistent streaming overlay styling with excellent readability

## Overlay Design

The overlay features a **unified design system** optimized for streaming:

- **Minimal Appearance**: Clean, professional look perfect for IRL/coding/gaming streams
- **Excellent Readability**: Strong text shadows and semi-transparent backgrounds work on any background
- **Consistent Styling**: All elements follow the same design language with subtle variations
- **No Interactivity**: Designed specifically for OBS browser sources (no hover effects)
- **Automatic Elements**: Heart rate display appears/disappears automatically based on data availability

### Stream Elements

- **Stream Vitals** (top-left): Heart rate monitor with smooth tempo transitions
- **Stream Info** (top-right): Time, location, weather display
- **Stream Movement** (below stream info): GPS minimap + speed display with smart auto-toggle
- **Future Elements**: Bottom corners available for expansion (stream stats, alerts, etc.)

## Deploy on Vercel

1. Deploy to [Vercel Platform](https://vercel.com/new)
2. Add all environment variables from `.env.local` to your Vercel project settings
3. Set up [Vercel KV](https://vercel.com/docs/storage/vercel-kv) for settings storage
4. Update `KV_REST_API_URL` and `KV_REST_API_TOKEN` in environment variables

## Pulsoid Heart Rate Setup

1. Create account at [Pulsoid.net](https://pulsoid.net)
2. Request API access token:
   - **For personal use**: Use [Manual Token Issuing](https://docs.pulsoid.net/access-token-management/manual-token-issuing)
   - **For applications**: Use [OAuth2 flow](https://docs.pulsoid.net/access-token-management/oauth2-authorization-code-grant)
3. Add your token to `.env.local` as `NEXT_PUBLIC_PULSOID_TOKEN`
4. Connect your heart rate monitor (Polar H10, Apple Watch, etc.) to Pulsoid app
5. Heart rate display will **automatically appear** when data is received and disappear when disconnected

### Heart Rate Features

- **Auto Show/Hide**: Appears automatically when heart rate data is available
- **Smooth Transitions**: BPM changes smoothly over 2 seconds instead of jumping
- **Realistic Animation**: Heart beats in sync with your actual BPM with double-beat pattern
- **Auto-timeout**: Disappears automatically if no data received for 30 seconds

## GPS Minimap & Movement Features

The movement section combines GPS visualization with speed tracking:

- **English Labels**: Uses CartoDB Voyager tiles with English street names worldwide
- **Smart Auto-Toggle**: Two modes via admin panel:
  - **Manual Toggle**: Show/hide minimap independently 
  - **Speed-Based Auto**: Show minimap + speed together when moving >10 km/h
- **Circular Design**: 80px circular minimap with red center dot
- **Real-time Updates**: Updates immediately when you move to new locations
- **Linked Display**: Speed and map appear/disappear together in auto mode
- **Admin Controls**: Toggle minimap and auto-show behavior from admin panel
- **Auto-timeout**: Disappears if no GPS data for 2 minutes

### Movement Section Technical Details

- **Tile Source**: CartoDB Voyager (English labels globally)
- **Zoom Level**: 15 (good street-level detail)
- **Update Frequency**: Updates with every GPS coordinate change  
- **Position**: Below main info card (top-right area)
- **Size**: 80x80px circular minimap + speed display
- **Languages**: English street names in Japan and worldwide

## Security Notes

- Change `ADMIN_PASSWORD` from the default for production
- Consider using stronger authentication for sensitive deployments
- The password is stored in localStorage for session persistence
