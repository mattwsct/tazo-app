# Tazo App - Streaming Overlay & Admin Tools

A fullstack Next.js web app that powers streaming overlays and admin tools, all in one clean, scalable codebase.

## 🎯 Features

### 1. OBS Overlay
- **Real-time Display**: Local time, location name, weather, temperature, and speed
- **GPS Integration**: Gets GPS + speed data from RTIRL
- **External APIs**: 
  - LocationIQ for reverse geocoding
  - OpenWeatherMap for weather and temperature
  - TimezoneDB for local time
- **Data Updates**: API polling (no WebSockets on frontend)
- **Customizable**: Toggle overlay features on/off

### 2. Admin Panel
- **Web Interface**: Toggle overlay features (show/hide speed, debug info)
- **Real-time Monitoring**: View current GPS, weather, and time data
- **API Testing**: Manually test Pulsoid, Kick, and other API connections
- **Settings Management**: Configure API keys and preferences

### 3. Kick Integration
- **Event Listener**: Backend listener for subs, followers, gifted subs, chat messages
- **Auto-messages**: Option to post auto-messages to chat
- **WebSocket/Webhook**: Uses WebSocket or webhook (depending on what Kick supports)
- **Event Storage**: Events stored in Redis and shown in admin panel or overlay

### 4. Pulsoid Integration
- **Real-time Heart Rate**: Fetches heart rate data via Pulsoid API
- **Overlay Display**: Displays heart rate in overlay (optional toggle)
- **Data History**: Stores heart rate history for analysis

## 🧱 Tech Stack

- **Frontend & Backend**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Data Fetching**: SWR for client-side data polling
- **Database**: Upstash Redis for caching and shared state
- **Hosting**: Vercel
- **Icons**: Heroicons
- **Date Handling**: date-fns with timezone support

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Upstash Redis account
- API keys for external services

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/tazo-app.git
   cd tazo-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env.local
   ```
   
   Edit `.env.local` and add your API keys:
   ```env
   # Upstash Redis Configuration
   UPSTASH_REDIS_REST_URL=your_upstash_redis_url_here
   UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token_here

   # LocationIQ API (for reverse geocoding)
   LOCATIONIQ_API_KEY=your_locationiq_api_key_here

   # OpenWeatherMap API (for weather data)
   OPENWEATHER_API_KEY=your_openweathermap_api_key_here

   # Pulsoid API (for heart rate data)
   PULSOID_ACCESS_TOKEN=your_pulsoid_access_token_here
   # Pulsoid WebSocket (for real-time heart rate data)
   PULSOID_WEBSOCKET_TOKEN=your_pulsoid_websocket_token_here

   # Kick Integration (optional)
   KICK_CHANNEL_NAME=your_kick_channel_name_here
   KICK_BOT_TOKEN=your_kick_bot_token_here

   # App Configuration
   NEXT_PUBLIC_APP_URL=https://app.tazo.wtf
   NODE_ENV=development
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   - Admin Panel: http://localhost:3000
   - Overlay: http://localhost:3000/overlay

## 📡 API Endpoints

### Overlay Data
- `GET /api/overlay-data` - Get combined overlay data (time, location, weather, speed, heart rate)

### GPS Integration
- `POST /api/gps` - Receive GPS data from RTIRL
- `GET /api/gps` - Get current GPS data

### External Services
- LocationIQ: Reverse geocoding and timezone data
- OpenWeatherMap: Weather and temperature data
- Pulsoid: Real-time heart rate data

## 🎮 OBS Setup

1. **Add Browser Source** in OBS
2. **URL**: `https://app.tazo.wtf/overlay`
3. **Width**: 1920
4. **Height**: 1080
5. **Custom CSS**: (optional) Add custom styling

### Overlay Features
- **Time**: Top-left corner, updates every second
- **Location**: Below time, updates when GPS changes
- **Weather**: Top-right corner, shows temperature and condition
- **Speed**: Bottom-left corner (toggleable)
- **Heart Rate**: Bottom-right corner (toggleable)
- **Debug Info**: Center (toggleable, development only)

## 🔧 Configuration

### Overlay Controls
- Toggle features on/off via admin panel
- Configure update intervals
- Customize display positions
- Set default values

### API Settings
- Configure all external API keys
- Set rate limits and timeouts
- Enable/disable specific integrations

## 🌐 Deployment

### Vercel (Recommended)

#### 1. **Prepare for Deployment**
```bash
# Build locally to test
npm run build

# Install Vercel CLI (optional)
npm i -g vercel
```

#### 2. **Deploy to Vercel**
- **Option A**: Connect GitHub repo to Vercel (recommended)
  - Go to [vercel.com](https://vercel.com)
  - Import your GitHub repository
  - Vercel will auto-detect Next.js settings

- **Option B**: Deploy via CLI
  ```bash
  vercel
  ```

#### 3. **Configure Environment Variables**
In your Vercel dashboard, add these environment variables:
```env
# Required for data persistence
UPSTASH_REDIS_REST_URL=your_upstash_redis_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token

# External APIs
LOCATIONIQ_API_KEY=your_locationiq_key
OPENWEATHER_API_KEY=your_openweather_key
PULSOID_ACCESS_TOKEN=your_pulsoid_token
PULSOID_WEBSOCKET_TOKEN=your_pulsoid_websocket_token

# App Configuration
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
NODE_ENV=production
```

#### 4. **Data Persistence**
- ✅ **Redis data survives redeploys** - Your heart rate, GPS, and config data is safe
- ✅ **WebSocket connections** - Automatically reconnect after redeploy
- ✅ **Overlay configuration** - Stored in Redis, persists across deployments

### Alternative Hosting Options
- **Netlify**: Similar to Vercel, good for static sites
- **Railway**: Good for full-stack apps with databases
- **DigitalOcean App Platform**: More control, good for complex apps

## 📊 Data Flow

1. **GPS Data**: RTIRL → `/api/gps` → Redis
2. **Location**: GPS coordinates → LocationIQ → Redis
3. **Weather**: GPS coordinates → OpenWeatherMap → Redis
4. **Heart Rate**: Pulsoid WebSocket/API → Redis
5. **Overlay**: Redis → `/api/overlay-data` → Frontend

## 🔌 Integrations

### RTIRL (GPS Data)
Configure RTIRL to send GPS data to your `/api/gps` endpoint:
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "speed": 25.5
}
```

### Kick Integration
- WebSocket connection for real-time events
- Event storage in Redis
- Optional auto-message posting

### Pulsoid Integration
- Real-time heart rate monitoring via WebSocket
- API polling fallback
- Historical data storage
- Overlay display integration

## 🛠️ Development

### Project Structure
```
src/
├── app/                 # Next.js App Router
│   ├── api/            # API routes
│   ├── overlay/        # OBS overlay page
│   ├── globals.css     # Global styles
│   ├── layout.tsx      # Root layout
│   └── page.tsx        # Admin dashboard
├── lib/                # Utilities and services
│   ├── redis.ts        # Redis client
│   └── services/       # External API services
├── types/              # TypeScript definitions
└── components/         # React components
```

### Available Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For support, please open an issue on GitHub or contact the maintainer.

---

**Built with ❤️ for the streaming community** 