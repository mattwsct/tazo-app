# IRL Stream Overlay (Next.js)

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in your API keys and secrets.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run locally:
   ```bash
   npm run dev
   ```
4. Deploy to Vercel and set the same environment variables in the dashboard.

## Environment Variables
- `LOCATIONIQ_KEY`: Your LocationIQ API key
- `OPENWEATHER_KEY`: Your OpenWeatherMap API key
- `TIMEZONEDB_KEY`: Your TimezoneDB API key
- `RTIRL_PULL_KEY`: Your RTIRL pull key
- `ADMIN_PASSWORD`: Password for the admin panel
- `VERCEL_KV_REST_API_URL` and `VERCEL_KV_REST_API_TOKEN`: Provided by Vercel KV

## Features
- Overlay for OBS: time, location, weather, speed
- Admin panel for toggling elements and location precision
- Persistent last-known data (even after redeploy)
- Mobile-friendly admin

## Notes
- All sensitive info must be set in `.env.local` (never committed)
- Overlay is transparent and responsive for OBS
