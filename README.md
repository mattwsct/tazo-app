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
- **Auto-show when moving** (>5 km/h) - Shows when speed exceeds walking pace
- **Auto-hide when stationary** - Hides when speed drops below 5 km/h or GPS becomes stale
- **GPS staleness detection** - Hides if no GPS updates received in 10 seconds
- **Day/night map styling** - Based on real sunrise/sunset times from OpenWeatherMap API
- **Fade transitions** - Smooth 1-second fade in/out for better visual experience

### Location Display Modes
The overlay supports 5 location display modes, each showing different levels of geographic detail:

- **Neighborhood** - Most precise: Shows neighborhood/suburb/district names (e.g., "Downtown", "SoHo", "Shinjuku")
  - Falls back to city → county → state if neighborhood data unavailable
  - Best for: City exploration, walking tours, detailed location tracking
  
- **City** - City-level precision: Shows city/town/municipality names (e.g., "Austin", "Tokyo", "Paris")
  - Falls back to county → state if city data unavailable
  - Best for: General travel, transit, city-to-city movement
  
- **Country** - Broadest GPS mode: Shows only country name (and state if country was abbreviated, e.g., "Texas, USA")
  - Primary line stays empty, country shown on second line with flag
  - Best for: International flights, country-level tracking
  
- **Custom** - Manual text entry: Set your own location text (e.g., "Las Vegas Strip", "Tokyo Station")
  - Optionally show country name and flag below custom text (toggle in admin panel)
  - Works even without GPS data (useful for pre-planned locations)
  - Best for: Specific landmarks, custom location names, pre-planned routes
  
- **Hidden** - No location displayed: Completely hides location section
  - Weather and minimap still function independently
  - Best for: Weather-only or minimap-only overlays

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

- **Location Display** - Choose precision level (Neighborhood/City/Country) or custom text
  - Changes apply immediately to overlay via real-time sync
  - Location re-formats instantly when mode changes (uses cached location data)
  
- **Custom Location** - Enter custom text when "Custom" mode is selected
  - Auto-saves after 1 second of no typing (debounced)
  - Optional country name/flag display toggle
  
- **Weather** - Show/hide temperature display
  - Temperature updates every 5 minutes automatically
  - Shows both °C and °F
  
- **Minimap** - Three display modes:
  - **Always Show** - Minimap always visible (if GPS data available)
  - **Auto on Movement** - Shows when speed >5 km/h, hides when stationary or GPS stale
  - **Hidden** - Minimap completely hidden
  
- **Map Zoom** - 6 levels from Continental (1) to Neighborhood (13)
  - Continental (1) - Trans-oceanic view
  - Ocean (3) - Coastal view from sea
  - National (5) - Country view
  - Regional (8) - State/province view
  - City (11) - Whole city view
  - Neighborhood (13) - Streets & buildings

- **To-Do List** - Add, edit, complete, and delete tasks
  - Shows on overlay when enabled
  - Tasks sorted: incomplete first, then completed

### Settings Sync Mechanism
Settings changes propagate to overlay in real-time via:
1. **Server-Sent Events (SSE)** - Primary method, instant updates (<1 second)
   - Requires Vercel KV for persistence
   - Falls back to polling if SSE unavailable
2. **Polling Fallback** - Checks for updates every 5 seconds
   - Used when SSE not available (e.g., no KV configured)
   - Ensures settings eventually sync even without SSE

**Important**: SSE messages include metadata (`type`, `timestamp`) that must be stripped before setting state. Always extract only settings properties when handling SSE updates.

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
- Ensure you're moving >5 km/h (or set to "Always On" mode)
- Check Mapbox token is valid
- Verify GPS data is fresh (updates received within last 10 seconds)
- Check browser console for GPS staleness warnings

**Weather not displaying?**
- Verify OpenWeatherMap API key
- Check browser console for API errors

**Admin panel won't load?**
- Set `ADMIN_PASSWORD` in environment variables
- Restart dev server after adding env vars

**Duplicate console logs in development?**
- This is normal! Next.js 15 enables React StrictMode by default in development
- StrictMode intentionally renders components twice to detect side effects
- Logs will appear twice - this is expected behavior and won't happen in production
- To reduce log noise, check browser console filters or disable StrictMode (not recommended)

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
   - **GPS Freshness**: Location/weather/minimap hide when GPS update is >15 minutes old
   - **Data Validity**: Weather and location data cached for 30 minutes even if GPS becomes stale
   - **Incomplete Data Handling**: If LocationIQ returns country name but no country code, entire top-right section hides (prevents showing incomplete data)
   - Hide incomplete data rather than show errors
   - Progressive enhancement (show what you have)
   - Priority: Location > Weather > Minimap

### Common Scenarios
- **Flying**: High speed (>200 km/h), infrequent location updates (1km threshold), country-level display recommended
- **Cruising**: International waters, water body detection critical, show nearest country, ocean zoom level
- **City Exploration**: Frequent updates (10m threshold), detailed location names, neighborhood-level display recommended
- **Transit**: Medium speed (50-200 km/h), moderate update frequency (100m threshold), city-level display recommended
- **Walking**: Low speed (<50 km/h), frequent updates (10m threshold), neighborhood or city display

### Location Display Mode Selection Guide
- **Neighborhood**: Use when you want maximum detail (e.g., "Downtown", "SoHo", "Shinjuku")
  - Best for: Walking tours, city exploration, detailed location tracking
  - Falls back to city if neighborhood data unavailable
  
- **City**: Use for general city-level tracking (e.g., "Austin", "Tokyo", "Paris")
  - Best for: General travel, transit, city-to-city movement
  - Most commonly used mode
  
- **Country**: Use for broad geographic tracking (e.g., "USA", "Japan", "France")
  - Best for: International flights, country-level tracking
  - Shows state if country was abbreviated (e.g., "Texas, USA")
  
- **Custom**: Use for specific landmarks or pre-planned locations
  - Best for: Specific venues, custom location names, pre-planned routes
  - Works without GPS data (manual entry)
  - Can optionally show country/flag below custom text

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
- **Data Caching**: Always cache data for smooth transitions (30-minute validity windows)
  - `WEATHER_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `LOCATION_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `GPS_FRESHNESS_TIMEOUT`: 15 minutes (when to hide location/weather)
  - `GPS_STALE_TIMEOUT`: 10 seconds (when GPS data is considered stale)
  
- **Incomplete Data Handling**: Hide incomplete data rather than show errors
  - `hasIncompleteLocationData` flag: Set when LocationIQ returns country name but no country code
  - Entire top-right section (location/weather/minimap) hides when flag is true
  - Prevents showing "United States of America" without a flag
  
- **Settings Updates**: Handle SSE messages correctly
  - SSE messages include `type` and `timestamp` metadata
  - Always extract only settings properties: `const { type, timestamp, ...settingsData } = data`
  - Location re-formats immediately when settings change (uses `lastRawLocation.current`)
  
- **API Efficiency**: Use adaptive thresholds based on speed
  - Track successful fetches separately from last attempt times (`lastSuccessfulWeatherFetch`, `lastSuccessfulLocationFetch`)
  - Use refs for synchronous updates (GPS timestamps, API call tracking)
  - Prevent concurrent API calls with `weatherFetchInProgress` and `locationFetchInProgress` flags
  
- **Location Formatting**: Location display updates instantly when settings change
  - `useEffect` watches `settings` and re-formats `lastRawLocation.current` immediately
  - No need to wait for new GPS update to see display mode change
  - Falls back gracefully if formatting fails (keeps existing display)

### Design Improvements Implemented
- ✅ Enhanced text shadows for better readability on stream
- ✅ Increased font weights (location: 700, weather: 800)
- ✅ Larger flags (32px) and weather icons (24px) for visibility
- ✅ Adaptive location update thresholds based on speed
- ✅ Smooth CSS transitions for appearance/disappearance
- ✅ Tabular numbers for consistent temperature display

### Common Issues & Gotchas for AI Assistants

1. **Settings Not Updating on Overlay**
   - **Cause**: SSE messages include `type` and `timestamp` metadata that must be stripped
   - **Fix**: Always extract only settings: `const { type, timestamp, ...settingsData } = data`
   - **Check**: Verify `setSettings()` receives clean `OverlaySettings` object, not SSE message object

2. **Location Display Mode Not Reflecting Changes**
   - **Cause**: Location state not re-formatting when settings change
   - **Fix**: Ensure `useEffect` watching `settings` re-formats `lastRawLocation.current` immediately
   - **Check**: Location should update instantly when display mode changes (no GPS update needed)

3. **Location Showing "Neighborhood" When "City" Selected**
   - **Cause**: Location data might have neighborhood fields but not city fields
   - **Fix**: Check `getLocationByPrecision()` fallback order - city mode should prioritize city fields
   - **Check**: Verify `formatLocation()` is called with correct `displayMode` parameter

4. **Country Name Without Flag**
   - **Cause**: LocationIQ returned country name but no country code
   - **Fix**: Set `hasIncompleteLocationData = true` and hide entire top-right section
   - **Check**: Never show country name without flag - better to hide section entirely

5. **GPS Staleness vs Data Validity**
   - **GPS Freshness** (15 min): When to hide location/weather/minimap (GPS update age)
   - **Data Validity** (30 min): How long cached data remains usable (weather/location cache)
   - **GPS Stale** (10 sec): When GPS data is considered stale (no updates received)
   - **Important**: Data can be valid (cached) even if GPS is stale - this allows instant re-display

6. **Minimap Speed Threshold**
   - **Actual**: 5 km/h (walking pace), not 10 km/h as might be documented elsewhere
   - **Check**: `WALKING_PACE_THRESHOLD = 5` in overlay page code

7. **Location Display Modes**
   - **Actual modes**: `'neighborhood' | 'city' | 'country' | 'custom' | 'hidden'`
   - **Not**: "State" mode (doesn't exist - use "Country" mode instead)
   - **Check**: `LocationDisplayMode` type in `src/types/settings.ts`

8. **Settings Sync Timing**
   - **SSE**: Primary method, instant (<1 second)
   - **Polling**: Fallback, checks every 5 seconds
   - **Both**: Should work, but SSE preferred for real-time updates

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
