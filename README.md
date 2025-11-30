# 🎮 Tazo Streaming Overlay

A modern, real-time streaming overlay for IRL streams with GPS tracking, weather display, and heart rate monitoring.

## ✨ Features

- **📍 Real-time GPS Location** - Smart minimap that shows/hides based on movement
- **🌤️ Live Weather** - Temperature with day/night-aware icons
- **💓 Heart Rate Monitor** - Pulsoid integration for live heart rate display
- **🌊 At-Sea Mode** - Automatic water body detection for cruise/ocean streaming
- **🗺️ Smart Location Display** - City, state, or custom location names with country flags
- **🎨 Clean UI** - Modern, responsive design optimized for OBS

## 🚀 Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure Environment
Create `.env.local` in project root:

```env
# Required - GPS Tracking
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key

# Required - Location & Weather
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_key
NEXT_PUBLIC_OPENWEATHERMAP_KEY=your_openweathermap_key

# Optional - Additional Features
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_token
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token

# Optional - Admin Panel & Settings Sync
ADMIN_PASSWORD=your_admin_password
KV_REST_API_URL=your_vercel_kv_url
KV_REST_API_TOKEN=your_vercel_kv_token
KV_REST_API_READ_ONLY_TOKEN=your_vercel_kv_readonly_token
```

### 3. Run
```bash
npm run dev
```

- **Admin Panel**: `http://localhost:3000`
- **Overlay**: `http://localhost:3000/overlay`

## 🎯 Key Features Explained

### Smart GPS Minimap
- **Auto-show when moving** (>10 km/h)
- **Auto-hide when stationary**
- **Day/night map styling** based on real sunrise/sunset times

### Location Display Modes
- **City** - "French Quarter, New Orleans"
- **State** - "Louisiana, United States"
- **Custom** - Set your own text
- **Hidden** - No location displayed

### At-Sea Detection
When GPS coordinates can't be reverse geocoded (ocean/remote areas):
- Automatically detects water bodies: "Gulf of Mexico 🇺🇸"
- Covers major seas and oceans worldwide
- Shows appropriate regional flag

### Weather Integration
- Temperature in both °C and °F
- Day/night weather icons (based on astronomical sunrise/sunset)
- Auto-updates every 5 minutes
- Location-based weather for your current GPS position

## 🔧 Admin Panel Settings

Access at `http://localhost:3000` to configure:

- **Location Display** - Choose precision level or custom text
- **Weather** - Show/hide temperature display
- **Minimap** - Smart mode, always on, or hidden
- **Map Zoom** - 6 levels from Continental (1) to Neighborhood (13)
  - Continental (1) - Trans-oceanic view
  - Ocean (3) - Coastal view from sea
  - National (5) - Country view
  - Regional (8) - State/province view
  - City (11) - Whole city view
  - Neighborhood (13) - Streets & buildings
- **Country Flag** - Show/hide flag in custom location mode

## 🌐 API Services

### Required
- **RealtimeIRL** - GPS tracking ([realtimeirl.com](https://realtimeirl.com/))
- **LocationIQ** - Reverse geocoding ([locationiq.com](https://locationiq.com/))
- **OpenWeatherMap** - Weather & sunrise/sunset ([openweathermap.org](https://openweathermap.org/))

### Optional
- **Pulsoid** - Heart rate monitoring ([pulsoid.net](https://pulsoid.net/))
- **Mapbox** - Map tiles ([mapbox.com](https://mapbox.com/))
- **Vercel KV** - Settings persistence ([vercel.com/storage/kv](https://vercel.com/storage/kv))

## 🚢 Deployment

### Vercel (Recommended)
```bash
vercel --prod
```

Set environment variables in Vercel dashboard → Project Settings → Environment Variables

### OBS Setup
1. Add **Browser Source** in OBS
2. URL: `https://your-domain.com/overlay`
3. Width: `1920`, Height: `1080`
4. Check "Shutdown source when not visible"
5. Refresh browser when scene becomes active: ✓

## 📊 API Usage

All APIs are within free tier limits for 24/7 streaming:

- **OpenWeatherMap**: ~288 calls/day (0.03% of limit)
- **LocationIQ**: ~1,440 calls/day (29% of limit)
- **Mapbox**: Cached tiles, minimal usage

Rate limiting and cooldowns are built-in to prevent quota issues.

## 🛠️ Tech Stack

- **Next.js 15** - React framework with app router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **MapLibre GL** - Map rendering
- **Server-Sent Events** - Real-time settings sync

## 📝 Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run linter
```

## 🐛 Troubleshooting

**GPS not updating?**
- Check RTIRL pull key is correct
- Verify you're broadcasting location in RealtimeIRL app

**Minimap not showing?**
- Ensure you're moving >10 km/h (or set to "Always On" mode)
- Check Mapbox token is valid

**Weather not displaying?**
- Verify OpenWeatherMap API key
- Check browser console for API errors

**Admin panel won't load?**
- Set `ADMIN_PASSWORD` in environment variables
- Restart dev server after adding env vars

## 🔒 Security

- Admin password is HTTP-only cookie, never exposed to client
- API keys with `NEXT_PUBLIC_` prefix are safe (domain-restricted, rate-limited)
- All external API tokens are read-only access

## 🎨 Design Principles & Notes for AI Assistants

### Key Design Principles
1. **Readability First**: Text must be legible on stream at 1080p resolution
   - Use font-weight 700+ for critical information
   - Double text shadows for depth and readability
   - Letter spacing for better legibility
   - Tabular numbers for consistent temperature display

2. **International Ready**: Handle all countries, languages, and formats
   - Normalize country names to English for consistency
   - Support international characters and long city names
   - Graceful handling of missing country codes (hide section rather than show incomplete data)
   - Water body detection for cruise/ocean scenarios

3. **API Efficient**: Minimize calls while keeping data fresh
   - Adaptive location update thresholds based on speed:
     - Flights (>200 km/h): 1km threshold
     - Driving (50-200 km/h): 100m threshold  
     - Walking (<50 km/h): 10m threshold
   - Weather updates every 5 minutes (time-based, not movement-based)
   - Aggressive caching with 30-minute validity windows

4. **Performance Critical**: Smooth 60fps for OBS capture
   - CSS transitions for smooth appearance/disappearance
   - Hardware acceleration (transform: translateZ(0))
   - Backface visibility optimizations
   - Minimal re-renders with proper React memoization

5. **Graceful Degradation**: Always show something, even if APIs fail
   - Cache data for 30 minutes when GPS becomes stale
   - Hide incomplete data rather than show errors
   - Progressive enhancement (show what you have)
   - Priority: Location > Weather > Minimap

### Common Scenarios
- **Flying**: High speed, infrequent location updates needed, country-level display
- **Cruising**: International waters, water body detection critical, show nearest country
- **City Exploration**: Frequent updates, detailed location names, neighborhood-level display
- **Transit**: Medium speed, moderate update frequency, city-level display

### Visual Hierarchy
- **Location**: Primary information, largest text (1.875rem), weight 700
- **Weather**: Secondary information, smaller text (1.125rem), weight 800
- **Flags**: 32px width for visibility, subtle border for contrast
- **Icons**: 24px for weather icons, drop shadows for visibility

### API Rate Limits (Free Tier)
- **LocationIQ**: 1 call/second, 5,000 calls/day
- **OpenWeatherMap**: 60 calls/minute, 1,000,000 calls/month
- **Mapbox**: Cached tiles, minimal direct API calls

### Important Code Patterns
- Always cache data for smooth transitions (30-minute validity)
- Hide incomplete data rather than show errors (`hasIncompleteLocationData` flag)
- Use adaptive thresholds based on speed for API efficiency
- Track successful fetches separately from last attempt times
- Use refs for synchronous updates (GPS timestamps)

### Design Improvements Implemented
- ✅ Enhanced text shadows for better readability on stream
- ✅ Increased font weights (location: 700, weather: 800)
- ✅ Larger flags (32px) and weather icons (24px) for visibility
- ✅ Adaptive location update thresholds based on speed
- ✅ Smooth CSS transitions for appearance/disappearance
- ✅ Tabular numbers for consistent temperature display

### Future Enhancement Ideas
- Smart location name truncation with ellipsis
- Dynamic minimap zoom based on speed
- Loading indicators during API calls
- Country name normalization to English
- Compass indicator for orientation
- Travel direction/heading display

## 📄 License

MIT License - feel free to use and modify!

---

**Built for the IRL streaming community** 🚀
