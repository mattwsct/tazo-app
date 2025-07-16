# Tazo Streaming Overlay

A real-time streaming overlay for OBS with admin panel, built with Next.js 15. Displays location, weather, speed, and time data from RealtimeIRL and Open-Meteo APIs.

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# RealtimeIRL API Key (required)
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key_here

# LocationIQ API Key (required for location names)
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_api_key_here

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
- ⚙️ **Admin Panel**: Real-time settings control with auto-save
- 📡 **Real-time Updates**: Server-sent events for instant setting changes

## Deploy on Vercel

1. Deploy to [Vercel Platform](https://vercel.com/new)
2. Add all environment variables from `.env.local` to your Vercel project settings
3. Set up [Vercel KV](https://vercel.com/docs/storage/vercel-kv) for settings storage
4. Update `KV_REST_API_URL` and `KV_REST_API_TOKEN` in environment variables

## Security Notes

- Change `ADMIN_PASSWORD` from the default for production
- Consider using stronger authentication for sensitive deployments
- The password is stored in localStorage for session persistence
