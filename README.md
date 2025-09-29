# 🎮 Tazo Streaming Overlay

A modern, real-time streaming overlay for IRL streams with GPS tracking, weather display, and Kick.com integration.

## ✨ Features

- **📍 GPS Location Tracking** - Real-time location with smart minimap display
- **🌤️ Weather Integration** - Current weather conditions and temperature
- **🎯 Kick.com Integration** - Subscription goals, latest subs, and leaderboards
- **🔗 Webhook Support** - Real-time Kick.com events via webhooks
- **🎬 OBS Integration** - Stream start/stop detection (legacy)
- **📱 Responsive Design** - Works on all screen sizes
- **🔒 Secure Admin Panel** - Protected settings management

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/your-username/tazo-app.git
cd tazo-app
npm install
```

### 2. Environment Setup
Create a `.env.local` file in your project root:

```bash
# Core Application (Required)
KV_REST_API_URL=https://your-kv-url.vercel-storage.com
KV_REST_API_TOKEN=your_kv_token_here
KV_REST_API_READ_ONLY_TOKEN=your_readonly_token_here
ADMIN_PASSWORD=your_secure_admin_password

# Kick.com Integration (Required for webhooks)
KICK_CLIENT_ID=your_kick_client_id
KICK_CLIENT_SECRET=your_kick_client_secret

# External APIs (Optional)
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_key
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_key
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_token
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token
```

### 3. Start Development
```bash
npm run dev
```

Visit `http://localhost:3000` for the admin panel and `http://localhost:3000/overlay` for the overlay.

## 🔧 Configuration

### Admin Panel
Access the admin panel at `http://localhost:3000` and configure:

- **Display Settings** - Weather and location display options
- **Location & Map** - GPS minimap and movement tracking
- **Kick.com** - Subscription goals and community features
- **Advanced** - System information and webhook status

### GPS Minimap Settings
- **Smart Display Mode** (Recommended) - Shows minimap only when moving (speed > 10 km/h)
- **Always Visible** - Shows minimap continuously
- **Location Display** - Choose city, state, country, or hidden

## 🎯 Kick.com Integration

### Webhook Setup
1. Go to [Kick.com Developer Portal](https://kick.com/developer)
2. Create an app and get your `client_id` and `client_secret`
3. Configure webhook URL: `https://your-domain.com/api/kick-webhook`
4. Subscribe to events: `livestream.status.updated`, `channel.subscription.new`, `channel.subscription.renewal`, `channel.subscription.gifts`

### Features
- **Real-time Sub Goals** - Track subscriptions during stream sessions
- **Latest Subscriber Display** - Show recent subscribers with animations
- **Gift Sub Leaderboard** - Top gift subscription contributors
- **Rolling Goals** - Automatically increase goals after completion
- **Stream-based Resets** - Reset goals when stream ends (with 1-hour timeout)

### Supported Events
- `livestream.status.updated` - Stream start/stop detection
- `channel.subscription.new` - New subscriptions
- `channel.subscription.renewal` - Subscription renewals
- `channel.subscription.gifts` - Gift subscriptions

## 🔒 Security

### Environment Variables Security
- **Server-side only** variables are secure and never exposed to the browser
- **Client-side** variables (with `NEXT_PUBLIC_` prefix) are safe for this use case
- **Admin password** is required and validated server-side
- **Webhook signatures** are verified using Kick.com's public key

### Safe to Expose (Client-Side)
| Variable | Purpose | Security |
|----------|---------|----------|
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Map rendering | Domain restrictions, usage limits |
| `NEXT_PUBLIC_RTIRL_PULL_KEY` | Location data | Rate limiting, public API |
| `NEXT_PUBLIC_LOCATIONIQ_KEY` | Geocoding | Usage quotas, domain restrictions |
| `NEXT_PUBLIC_PULSOID_TOKEN` | Heart rate data | Public token, rate limited |

### Server-Side Only (Secure)
| Variable | Purpose | Security |
|----------|---------|----------|
| `ADMIN_PASSWORD` | Admin authentication | HTTP-only cookies |
| `KICK_CLIENT_ID` | Kick.com API | Server-side only |
| `KICK_CLIENT_SECRET` | Kick.com API | Server-side only |
| `KV_REST_API_URL` | Database connection | Server-side only |
| `KV_REST_API_TOKEN` | Database access | Server-side only |

## 🗺️ GPS & Location Features

### Smart Display Mode
The GPS minimap automatically shows/hides based on movement:
- **Moving** (speed > 10 km/h) → Minimap visible
- **Stationary** (speed ≤ 10 km/h) → Minimap hidden
- **Perfect for IRL streams** - shows location when traveling

### Location Display Options
- **City** - Shows current city with state and country context
- **State/Province** - Shows current state/province with country context
- **Custom** - Displays custom text instead of GPS-based location
- **Hidden** - No location text displayed

### Supported Location Services
- **RTIRL** - Real-time location tracking
- **LocationIQ** - Geocoding and reverse geocoding
- **OpenMeteo** - Weather data based on location

## 🌤️ Weather Integration

### Features
- **Temperature Display** - Current temperature in Celsius and Fahrenheit
- **Location-based** - Weather updates based on GPS location
- **Auto-refresh** - Updates every 15 minutes
- **Country Flag** - Shows country flag next to temperature

### Weather Display
- Clean temperature-only display
- Country flag integration for quick location reference
- Responsive design for all screen sizes

## 🎬 OBS Integration

**Note**: OBS WebSocket integration has been completely removed. Stream start/stop detection is now handled exclusively via Kick.com webhooks, which provides more reliable and secure stream event detection.

## 🚀 Deployment

### Vercel (Recommended)
1. **Connect Repository**
   ```bash
   vercel --prod
   ```

2. **Set Environment Variables**
   - Go to Vercel Dashboard → Project Settings → Environment Variables
   - Add all variables from your `.env.local` file

3. **Configure Webhook URL**
   - Update your Kick.com webhook URL to: `https://your-domain.vercel.app/api/kick-webhook`

### Other Platforms
- **Netlify** - Similar to Vercel setup
- **Railway** - Use Railway's environment variable system
- **Heroku** - Use Heroku config vars

## 🐛 Troubleshooting

### Common Issues

#### "Environment validation failed"
- Check that all required variables are set
- Verify variable names are exactly as shown
- Ensure no sensitive variables use `NEXT_PUBLIC_` prefix

#### "Kick.com webhook not working"
- Verify webhook URL is correct: `https://your-domain.com/api/kick-webhook`
- Check that events are subscribed: `livestream.status.updated`, `channel.subscription.*`
- Ensure `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` are set
- Check webhook signature verification

#### "GPS minimap not showing"
- Verify `NEXT_PUBLIC_RTIRL_PULL_KEY` is set
- Check that you're moving (speed > 10 km/h) if using Smart Display Mode
- Ensure minimap is enabled in admin panel

#### "Admin login not working"
- Verify `ADMIN_PASSWORD` is set in environment variables
- Check that the password is correct
- Restart development server after adding environment variables

### Debug Steps

1. **Check Environment Variables**
   ```bash
   # Verify all required variables are set
   cat .env.local
   ```

2. **Test Webhook Endpoint**
   ```bash
   curl -X GET https://your-domain.com/api/kick-webhook
   ```

3. **Check Server Logs**
   - Vercel: Function logs in dashboard
   - Local: Terminal output during development

4. **Browser Console**
   - Check for JavaScript errors
   - Look for connection status messages
   - Verify API calls are working

## 📊 API Endpoints

### Core Endpoints
- `GET /api/health` - Health check and system status
- `GET /api/get-settings` - Retrieve overlay settings
- `POST /api/save-settings` - Save overlay settings
- `GET /api/settings-stream` - Real-time settings updates (SSE)

### Kick.com Integration
- `POST /api/kick-webhook` - Receive Kick.com webhook events
- `POST /api/manual-sub-update` - Manual sub count and latest sub updates

### Admin Authentication
- `POST /api/admin-login` - Admin login
- `POST /api/admin-logout` - Admin logout

## 🔧 Development

### Project Structure
```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── overlay/           # Overlay page
│   └── page.tsx           # Admin panel
├── components/            # React components
├── lib/                   # Utility libraries
├── styles/                # CSS styles
├── types/                 # TypeScript types
└── utils/                 # Helper utilities
```

### Key Technologies
- **Next.js 15** - React framework with app router
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Server-Sent Events** - Real-time updates
- **Vercel KV** - Database storage

### Development Commands
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you need help:

1. Check this documentation
2. Review the troubleshooting section
3. Check browser console for errors
4. Verify environment variables are set correctly
5. Test with the provided endpoints

## 🔄 Updates

This project is actively maintained and updated with:
- New Kick.com API features
- Security improvements
- Performance optimizations
- Bug fixes

---

**Built with ❤️ for the streaming community**

## 🚀 Recent Improvements

### LocationIQ API Optimization (Latest)
- **Daily Rate Limiting**: Added daily API call limits (1,000/day for free tier) to prevent quota exhaustion
- **Smart Caching**: Location data is now cached for 24 hours within 1km radius, reducing API calls by ~80%
- **Better Error Handling**: Improved error messages for rate limits and daily quota exceeded scenarios
- **Automatic Fallback**: When daily limit is reached, the app gracefully falls back to cached data

### Location Display Simplification (Latest)
- **Precision-Based System**: Replaced complex field-specific modes with intuitive precision levels
- **Automatic Fallbacks**: Each precision level automatically falls back to less specific names if needed
- **Cleaner Logic**: Eliminated redundant `city`/`municipality` modes in favor of `suburb`/`city`/`state`
- **API Fallback System**: Automatic fallback between LocationIQ and Mapbox when rate limits are hit

**Location Display Modes:**
- **`suburb`**: Most specific available (suburb → city → town → municipality → state → country)
- **`city`**: City-level precision (city → town → municipality → state → country)
- **`state`**: State/country level (state → country)
- **`hidden`**: No location display

**API Fallback System:**
- **Primary Service**: LocationIQ for best precision and international coverage
- **Fallback Service**: Mapbox when LocationIQ hits rate limits
- **Automatic Switching**: Seamless fallback without user intervention
- **Higher Reliability**: Two APIs ensure location names are always available

**Note**: If you're hitting daily limits frequently, consider:
1. Upgrading your LocationIQ plan for higher daily quotas
2. The app will automatically reset limits at midnight local time
3. Cached locations reduce the need for repeated API calls
4. The Mapbox fallback ensures location names are always available

## 📋 Environment Variables
